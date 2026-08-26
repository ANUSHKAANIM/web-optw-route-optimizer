import torch

class OPTWEnvironment:
    def __init__(self, num_nodes=50, max_time=24.0, batch_size=1, device="cpu", reward_decay_min=0.3,
                 enable_forecast_events=False, hazard_radius=0.4, forecast_update_interval=4.0,
                 forecast_noise=0.12, forecast_track_waypoints=5):
        self.num_nodes = num_nodes
        self.max_time = float(max_time)
        self.batch_size = batch_size
        self.device = device
        # Time-decay reward: a node's payoff shrinks linearly the later you
        # arrive, from 100% of its base reward at t=0 down to this floor
        # fraction at t=max_time (Yu et al. 2022 "decreasing profits" /
        # Panadero et al. 2022 "position-dependent rewards" style). Never
        # goes to zero, so a late visit is still worth something.
        self.reward_decay_min = reward_decay_min

        # Optional EXOGENOUS dynamics: rewards/deadlines driven by a
        # simulated external "hazard" track (stand-in for a cyclone
        # forecast) that evolves on its own clock, independent of the
        # agent's movement. Off by default -- when False, behavior is
        # identical to the plain OPTW environment above.
        self.enable_forecast_events = enable_forecast_events
        self.hazard_radius = hazard_radius
        self.forecast_update_interval = forecast_update_interval
        self.forecast_noise = forecast_noise
        self.forecast_track_waypoints = forecast_track_waypoints
        self.last_step_forecast_updated = False
        
    def reset(self, same_instance=False):
        """Generates problem instances in a single vectorized batch (B, N, ...)."""
        if not same_instance or not hasattr(self, 'coords'):
            self.coords = torch.rand((1, self.num_nodes, 2), device=self.device) * 2 - 1
            self.coords = self.coords.expand(self.batch_size, -1, -1).clone()
            
            diff = self.coords.unsqueeze(2) - self.coords.unsqueeze(1)
            self.dist_matrix = torch.norm(diff, dim=-1)

            self.opening_times = torch.zeros((self.batch_size, self.num_nodes), device=self.device)
            self.durations = torch.full((self.batch_size, self.num_nodes), 0.5, device=self.device)

            if self.enable_forecast_events:
                # Hazard track: a simulated external threat moving across the
                # map on its own schedule. Swap this for real forecast
                # advisory waypoints (time, lat, lon) in the real project.
                self.track_times = torch.linspace(0, self.max_time, self.forecast_track_waypoints, device=self.device)
                start = torch.rand(2, device=self.device) * 2 - 1
                end = torch.rand(2, device=self.device) * 2 - 1
                self.track_positions = torch.stack([
                    start + (end - start) * (t / self.max_time) for t in self.track_times
                ])
                self.last_forecast_update_time = 0.0
                self.rewards = None  # let _recompute_hazard_fields build these fresh
                self.closing_times = torch.full((self.batch_size, self.num_nodes), self.max_time, device=self.device)
                self._recompute_hazard_fields()
            else:
                self.closing_times = torch.full((self.batch_size, self.num_nodes), self.max_time, device=self.device)
                rewards_single = torch.randint(1, 10, (1, self.num_nodes), device=self.device, dtype=torch.float32)
                rewards_single[0, 0] = 0.0
                self.rewards = rewards_single.expand(self.batch_size, -1).clone()
                self.S_max = self.rewards.max().item() * 1.1

        self.current_node = torch.zeros(self.batch_size, dtype=torch.long, device=self.device)
        self.current_time = torch.zeros(self.batch_size, device=self.device)
        self.visited = torch.zeros((self.batch_size, self.num_nodes), dtype=torch.bool, device=self.device)
        self.visited[:, 0] = True
        self.last_step_forecast_updated = False
        
        return self.get_state()

    def _hazard_position_at(self, t):
        """Interpolate the hazard track to get its predicted position at
        time t. t can be a scalar or (N,) tensor."""
        t = torch.as_tensor(t, device=self.device).clamp(0, self.max_time)
        idx = torch.searchsorted(self.track_times, t, right=True).clamp(1, len(self.track_times) - 1)
        t0, t1 = self.track_times[idx - 1], self.track_times[idx]
        p0, p1 = self.track_positions[idx - 1], self.track_positions[idx]
        frac = ((t - t0) / (t1 - t0 + 1e-8)).unsqueeze(-1)
        return p0 + (p1 - p0) * frac

    def _recompute_hazard_fields(self):
        """Derives rewards and closing_times fresh from the CURRENT hazard
        track. Called at reset() and every time the forecast updates.
        Already-visited nodes are never touched -- an evacuated/collected
        node keeps whatever value it had at the moment it was visited."""
        node_xy = self.coords[0]  # (N, 2) -- shared across the batch

        sample_times = torch.linspace(0, self.max_time, 200, device=self.device)
        sample_pos = self._hazard_position_at(sample_times)  # (200, 2)
        dists = torch.norm(sample_pos.unsqueeze(1) - node_xy.unsqueeze(0), dim=-1)  # (200, N)
        min_dist, min_idx = dists.min(dim=0)
        impact_time = sample_times[min_idx]

        in_danger = min_dist < self.hazard_radius
        urgency = torch.clamp(1.0 - min_dist / self.hazard_radius, min=0.0)
        new_rewards = torch.where(in_danger, 2.0 + 8.0 * urgency, torch.full_like(urgency, 0.5))
        new_rewards[0] = 0.0  # depot never has a reward

        new_closing = torch.where(in_danger, (impact_time - 1.0).clamp(min=0.0),
                                   torch.full_like(impact_time, self.max_time))

        new_rewards = new_rewards.unsqueeze(0).expand(self.batch_size, -1).clone()
        new_closing = new_closing.unsqueeze(0).expand(self.batch_size, -1).clone()

        if self.rewards is None:
            self.rewards = new_rewards
            self.closing_times = new_closing
        else:
            still_open = ~self.visited
            self.rewards = torch.where(still_open, new_rewards, self.rewards)
            self.closing_times = torch.where(still_open, new_closing, self.closing_times)

        self.S_max = max(self.rewards.max().item(), 1.0) * 1.1

    def maybe_update_forecast(self):
        """Checks if enough simulated time has passed since the last
        forecast update; if so, perturbs the hazard track's still-future
        waypoints (a new advisory coming in) and re-derives rewards and
        deadlines for every node not yet visited. Returns True if an
        update fired, so callers (e.g. the interactive UI) can notify the
        user that the picture has changed."""
        if not self.enable_forecast_events:
            return False
        now = self.current_time.max().item()
        if now - self.last_forecast_update_time < self.forecast_update_interval:
            return False

        noise = torch.randn_like(self.track_positions) * self.forecast_noise
        future_mask = (self.track_times > now).unsqueeze(-1)
        self.track_positions = torch.where(future_mask, self.track_positions + noise, self.track_positions)
        self._recompute_hazard_fields()
        self.last_forecast_update_time = now
        return True

    def _decay_fraction(self, t):
        """Linear time-decay: 1.0 at t=0, reward_decay_min at t=max_time."""
        frac = 1.0 - (1.0 - self.reward_decay_min) * (t / self.max_time)
        return torch.clamp(frac, min=self.reward_decay_min, max=1.0)

    def get_effective_rewards(self):
        """(B, N) reward each node would ACTUALLY pay out if visited next,
        right now -- i.e. base reward discounted by how late you'd arrive.
        Purely a preview for display/decision-making; doesn't mutate state."""
        batch_indices = torch.arange(self.batch_size, device=self.device)
        travel_time = self.dist_matrix[batch_indices, self.current_node]
        arrival_time = self.current_time.unsqueeze(1) + travel_time
        wait_time = torch.clamp(self.opening_times - arrival_time, min=0.0)
        start_visit_time = arrival_time + wait_time
        return self.rewards * self._decay_fraction(start_visit_time)

    def get_state(self):
        """Returns batched static (B, N, 7) and dynamic (B, N, 9) features."""
        B, N = self.batch_size, self.num_nodes
        
        static_feats = torch.stack([
            self.coords[:, :, 0],
            self.coords[:, :, 1],
            self.durations / self.max_time,
            self.opening_times / self.max_time,
            self.closing_times / self.max_time,
            self.rewards / self.S_max,
            torch.ones((B, N), device=self.device)
        ], dim=-1)

        curr_t = self.current_time.unsqueeze(1) # (B, 1)
        batch_indices = torch.arange(B, device=self.device)
        travel_times = self.dist_matrix[batch_indices, self.current_node] # (B, N)
        t_after_travel = curr_t + travel_times

        dynamic_feats = torch.stack([
            (self.opening_times - curr_t) / self.max_time,
            (self.closing_times - curr_t) / self.max_time,
            curr_t.expand(-1, N) / self.max_time,
            (self.max_time - curr_t).expand(-1, N) / self.max_time,
            (self.opening_times - t_after_travel) / self.max_time,
            (self.closing_times - t_after_travel) / self.max_time,
            t_after_travel / self.max_time,
            (self.max_time - t_after_travel) / self.max_time,
            self.rewards * self._decay_fraction(t_after_travel) / self.S_max,
        ], dim=-1)

        return static_feats, dynamic_feats

    def get_admissibility_mask(self):
        """Vectorized 1D feasibility mask over all nodes: (B, N)."""
        batch_indices = torch.arange(self.batch_size, device=self.device)
        travel_time = self.dist_matrix[batch_indices, self.current_node] # (B, N)
        
        arrival_time = self.current_time.unsqueeze(1) + travel_time
        wait_time = torch.clamp(self.opening_times - arrival_time, min=0.0)
        start_visit_time = arrival_time + wait_time
        time_back_home = start_visit_time + self.durations + self.dist_matrix[:, :, 0]

        feasible = (start_visit_time <= self.closing_times) & (time_back_home <= self.max_time)
        return feasible & (~self.visited)

    def get_adjacency_matrix(self):
        """Vectorized 1-step lookahead adjacency matrix (B, N, N)."""
        B, N = self.batch_size, self.num_nodes
        
        curr_t = self.current_time.view(B, 1, 1)
        curr_node = self.current_node.view(B, 1, 1)
        
        batch_idx = torch.arange(B, device=self.device).view(B, 1, 1)
        dist_curr_i = self.dist_matrix[batch_idx, curr_node, torch.arange(N, device=self.device).view(1, N, 1)]
        
        t1 = curr_t + dist_curr_i
        t1_wait = torch.clamp(self.opening_times.unsqueeze(2) - t1, min=0.0)
        t1_start = t1 + t1_wait
        t1_end = t1_start + self.durations.unsqueeze(2)

        t2 = t1_end + self.dist_matrix
        t2_wait = torch.clamp(self.opening_times.unsqueeze(1) - t2, min=0.0)
        t2_start = t2 + t2_wait
        t2_end = t2_start + self.durations.unsqueeze(1)

        t_home = t2_end + self.dist_matrix[:, :, 0].unsqueeze(2)

        valid_i = t1_start <= self.closing_times.unsqueeze(2)
        valid_j = t2_start <= self.closing_times.unsqueeze(1)
        valid_home = t_home <= self.max_time

        adj = valid_i & valid_j & valid_home

        visited_mask_j = self.visited.unsqueeze(1)
        diag_mask = torch.eye(N, dtype=torch.bool, device=self.device).unsqueeze(0)

        adj = adj & (~visited_mask_j) & (~diag_mask)
        return adj

    def step(self, actions):
        """Executes step transitions, accepting both Tensors and standard Python integers."""
        if not isinstance(actions, torch.Tensor):
            actions = torch.tensor([actions], device=self.device, dtype=torch.long)
        elif actions.dim() == 0:
            actions = actions.unsqueeze(0)

        batch_indices = torch.arange(self.batch_size, device=self.device)
        travel_time = self.dist_matrix[batch_indices, self.current_node, actions]
        arrival_time = self.current_time + travel_time
        
        opening_times_act = self.opening_times[batch_indices, actions]
        durations_act = self.durations[batch_indices, actions]
        
        wait_time = torch.clamp(opening_times_act - arrival_time, min=0.0)
        start_visit_time = arrival_time + wait_time

        self.current_time = start_visit_time + durations_act
        self.current_node = actions
        self.visited[batch_indices, actions] = True

        decay = self._decay_fraction(start_visit_time)
        rewards_step = self.rewards[batch_indices, actions] * decay

        # The forecast evolves on its own clock -- check independently of
        # which node was just visited, purely based on elapsed simulated time.
        self.last_step_forecast_updated = self.maybe_update_forecast()

        mask = self.get_admissibility_mask()
        done = ~mask.any(dim=-1)

        if self.batch_size == 1:
            return self.get_state(), rewards_step.item(), done.item()
            
        return self.get_state(), rewards_step, done