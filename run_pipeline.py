import copy
import torch
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.widgets import Button
from env import OPTWEnvironment
from model import PointerNetwork

def greedy_search(env_initial, model):
    """Executes deterministic Greedy Search inference."""
    env = copy.deepcopy(env_initial)
    
    static_feats, dynamic_feats = env.get_state()
    
    # Squeeze batch dimension if present
    if static_feats.dim() == 3:
        static_feats = static_feats.squeeze(0)
        dynamic_feats = dynamic_feats.squeeze(0)

    h_lstm = torch.zeros(1, 128)
    c_lstm = torch.zeros(1, 128)
    prev_h_e = torch.zeros(env.num_nodes, 128)
    current_embedding = torch.zeros(1, 128)

    path = [0]
    total_reward = 0.0
    done = False

    with torch.no_grad():
        while not done:
            adj_mask = env.get_adjacency_matrix()
            mask = env.get_admissibility_mask()

            if adj_mask.dim() == 3:
                adj_mask = adj_mask.squeeze(0)
            if mask.dim() == 2:
                mask = mask.squeeze(0)

            if not mask.any():
                break

            h_lstm, c_lstm = model.lstm(current_embedding, (h_lstm, c_lstm))
            probs, h_e = model(
                static_feats, dynamic_feats, adj_mask, mask, prev_h_e, (h_lstm, c_lstm)
            )

            if probs.dim() > 1:
                probs = probs.squeeze(0)

            action = torch.argmax(probs).item()

            (static_feats, dynamic_feats), reward, done = env.step(action)
            if static_feats.dim() == 3:
                static_feats = static_feats.squeeze(0)
                dynamic_feats = dynamic_feats.squeeze(0)
            
            if isinstance(reward, torch.Tensor):
                reward = reward.item()

            path.append(action)
            total_reward += reward
            prev_h_e = h_e.detach()
            current_embedding = h_e[action].unsqueeze(0)

    # Handle single element/batched dist_matrix and current_time
    dist_matrix = env.dist_matrix.squeeze(0) if env.dist_matrix.dim() == 3 else env.dist_matrix
    curr_node = env.current_node.item() if isinstance(env.current_node, torch.Tensor) else env.current_node
    curr_time = env.current_time.item() if isinstance(env.current_time, torch.Tensor) else env.current_time

    return_travel_time = dist_matrix[curr_node, 0].item()
    path.append(0)
    final_time = curr_time + return_travel_time

    return path, total_reward, final_time


def beam_search(env_initial, model, beam_width=32, start_node=None,
                 initial_lstm_state=None, initial_prev_h_e=None, initial_embedding=None):
    """Executes Beam Search inference tracking the top `beam_width` partial routes.

    By default this plans a full route from the depot (matches original behavior).
    Pass `start_node` + `initial_lstm_state`/`initial_prev_h_e`/`initial_embedding`
    to instead plan the BEST CONTINUATION from wherever `env_initial` currently is
    (used for live rerouting) -- this conditions the search on the real decision
    history so far instead of resetting the decoder's memory to zero.
    """
    if start_node is None:
        start_node = 0
    if initial_lstm_state is None:
        initial_lstm_state = (torch.zeros(1, 128), torch.zeros(1, 128))
    if initial_prev_h_e is None:
        initial_prev_h_e = torch.zeros(env_initial.num_nodes, 128)
    if initial_embedding is None:
        initial_embedding = torch.zeros(1, 128)

    initial_beam = {
        'env': copy.deepcopy(env_initial),
        'h_lstm': initial_lstm_state[0],
        'c_lstm': initial_lstm_state[1],
        'prev_h_e': initial_prev_h_e,
        'current_embedding': initial_embedding,
        'path': [start_node],
        'total_reward': 0.0,
        'log_prob_score': 0.0,
        'done': False
    }

    beams = [initial_beam]
    completed_beams = []

    with torch.no_grad():
        while beams:
            candidate_beams = []

            for b in beams:
                if b['done']:
                    completed_beams.append(b)
                    continue

                env = b['env']
                static_feats, dynamic_feats = env.get_state()
                adj_mask = env.get_adjacency_matrix()
                mask = env.get_admissibility_mask()

                if static_feats.dim() == 3:
                    static_feats = static_feats.squeeze(0)
                    dynamic_feats = dynamic_feats.squeeze(0)
                if adj_mask.dim() == 3:
                    adj_mask = adj_mask.squeeze(0)
                if mask.dim() == 2:
                    mask = mask.squeeze(0)

                if not mask.any():
                    b['done'] = True
                    completed_beams.append(b)
                    continue

                h_lstm, c_lstm = model.lstm(b['current_embedding'], (b['h_lstm'], b['c_lstm']))
                probs, h_e = model(
                    static_feats, dynamic_feats, adj_mask, mask, b['prev_h_e'], (h_lstm, c_lstm)
                )

                if probs.dim() > 1:
                    probs = probs.squeeze(0)

                valid_indices = torch.masked_select(torch.arange(env.num_nodes), mask)
                valid_probs = probs[mask]

                top_k = min(beam_width, len(valid_probs))
                top_probs, top_nodes = torch.topk(valid_probs, top_k)

                for p, node_idx in zip(top_probs, top_nodes):
                    action = valid_indices[node_idx].item()

                    next_env = copy.deepcopy(env)
                    _, reward, done = next_env.step(action)
                    if isinstance(reward, torch.Tensor):
                        reward = reward.item()

                    new_beam = {
                        'env': next_env,
                        'h_lstm': h_lstm,
                        'c_lstm': c_lstm,
                        'prev_h_e': h_e.detach(),
                        'current_embedding': h_e[action].unsqueeze(0),
                        'path': b['path'] + [action],
                        'total_reward': b['total_reward'] + reward,
                        'log_prob_score': b['log_prob_score'] + torch.log(p + 1e-8).item(),
                        'done': done
                    }
                    candidate_beams.append(new_beam)

            if not candidate_beams:
                break

            candidate_beams.sort(key=lambda x: x['log_prob_score'], reverse=True)
            beams = candidate_beams[:beam_width]

    all_completed = completed_beams + beams
    best_beam = max(all_completed, key=lambda x: x['total_reward'])

    best_env = best_beam['env']
    dist_matrix = best_env.dist_matrix.squeeze(0) if best_env.dist_matrix.dim() == 3 else best_env.dist_matrix
    curr_node = best_env.current_node.item() if isinstance(best_env.current_node, torch.Tensor) else best_env.current_node
    curr_time = best_env.current_time.item() if isinstance(best_env.current_time, torch.Tensor) else best_env.current_time

    return_travel_time = dist_matrix[curr_node, 0].item()
    final_path = best_beam['path'] + [0]
    final_time = curr_time + return_travel_time

    return final_path, best_beam['total_reward'], final_time


def interactive_search(env_initial, model, beam_width=16):
    """Google-Maps-style interactive routing: total free choice + live rerouting.

    At every decision point:
      1. The BEST full route onward is (re)computed from wherever the user
         actually is right now, via beam search seeded with the real decision
         history (not reset to zero) -- this is the "recommended route".
      2. The user is shown EVERY currently feasible node, not just top picks,
         and is completely free to pick any of them -- follow the
         recommendation, jump somewhere else entirely, or stop.
      3. Whatever they pick becomes the new current position, and step 1
         repeats: the recommended route is recalculated from there. Exactly
         like a GPS recalculating the instant you take a different turn.
    """
    env = copy.deepcopy(env_initial)

    static_feats, dynamic_feats = env.get_state()
    if static_feats.dim() == 3:
        static_feats = static_feats.squeeze(0)
        dynamic_feats = dynamic_feats.squeeze(0)

    h_lstm = torch.zeros(1, 128)
    c_lstm = torch.zeros(1, 128)
    prev_h_e = torch.zeros(env.num_nodes, 128)
    current_embedding = torch.zeros(1, 128)

    path = [0]
    total_reward = 0.0
    done = False

    print("\n" + "=" * 60)
    print("     INTERACTIVE ROUTING MODE (free choice + live rerouting)      ")
    print("=" * 60)

    with torch.no_grad():
        while not done:
            adj_mask = env.get_adjacency_matrix()
            mask = env.get_admissibility_mask()

            if adj_mask.dim() == 3:
                adj_mask = adj_mask.squeeze(0)
            if mask.dim() == 2:
                mask = mask.squeeze(0)

            if not mask.any():
                print("\nNo more feasible stops from here -- heading back to depot.")
                break

            # Advance the decoder's recurrent state for this decision point.
            # We need h_e/hidden state regardless of what the user ends up
            # picking, since it's what "remembers" the path taken so far.
            h_lstm, c_lstm = model.lstm(current_embedding, (h_lstm, c_lstm))
            probs, h_e = model(
                static_feats, dynamic_feats, adj_mask, mask, prev_h_e, (h_lstm, c_lstm)
            )
            if probs.dim() > 1:
                probs = probs.squeeze(0)

            current_node = env.current_node.item()
            feasible_idx = torch.nonzero(mask, as_tuple=False).squeeze(-1).tolist()

            # Best route from HERE onward, conditioned on the real path so far
            # (not a fresh depot start) -- this is the live "recommended route".
            rec_path, rec_reward, rec_time = beam_search(
                env, model, beam_width=beam_width, start_node=current_node,
                initial_lstm_state=(h_lstm, c_lstm),
                initial_prev_h_e=prev_h_e,
                initial_embedding=current_embedding,
            )

            print(f"\nCurrently at N{current_node}  (t={env.current_time.item():.2f}h)")
            print("Recommended route from here: " + " -> ".join(f"N{n}" for n in rec_path) +
                  f"   (projected reward {rec_reward:.1f}, finishes at t={rec_time:.2f}h)")

            sorted_feasible = sorted(feasible_idx, key=lambda n: probs[n].item(), reverse=True)
            effective_rewards = env.get_effective_rewards()
            effective_rewards = effective_rewards.squeeze(0) if effective_rewards.dim() == 2 else effective_rewards
            feas_str = ", ".join(
                f"N{n}(+{effective_rewards[n].item():.1f} now, base "
                f"{env.rewards[0, n].item():.0f})"
                for n in sorted_feasible
            )
            print(f"You're free to go anywhere feasible next: {feas_str}")
            print("  [Enter] follow the recommended next stop   "
                  "[<node_id>] go there instead, e.g. '12'   [q] stop here -> depot")

            action = _get_user_action(feasible_idx, rec_path)
            if action is None:
                break

            (static_feats, dynamic_feats), reward, done = env.step(action)
            if static_feats.dim() == 3:
                static_feats = static_feats.squeeze(0)
                dynamic_feats = dynamic_feats.squeeze(0)
            if isinstance(reward, torch.Tensor):
                reward = reward.item()

            path.append(action)
            total_reward += reward
            prev_h_e = h_e.detach()
            current_embedding = h_e[action].unsqueeze(0)

            print(f"  -> Routed to N{action} (+{reward:.1f} pts). "
                  f"Now at t={env.current_time.item():.2f}h.")
            if getattr(env, "last_step_forecast_updated", False):
                print("  \u26a0\ufe0f  New forecast update! Rewards and evacuation "
                      "deadlines for unvisited places have shifted.")

    dist_matrix = env.dist_matrix.squeeze(0) if env.dist_matrix.dim() == 3 else env.dist_matrix
    curr_node = env.current_node.item() if isinstance(env.current_node, torch.Tensor) else env.current_node
    curr_time = env.current_time.item() if isinstance(env.current_time, torch.Tensor) else env.current_time

    return_travel_time = dist_matrix[curr_node, 0].item()
    path.append(0)
    final_time = curr_time + return_travel_time

    print(f"\nReturning to depot (+{return_travel_time:.2f}h travel). "
          f"Final time: {final_time:.2f}h | Total reward: {total_reward:.1f}")

    return path, total_reward, final_time


def _get_user_action(feasible_idx, rec_path):
    """Reads and validates one decision: Enter = follow recommendation,
    a node id = go there freely instead, 'q' = stop and return to depot."""
    while True:
        choice = input("Your choice: ").strip().lower()

        if choice == "q":
            return None

        if choice == "":
            if len(rec_path) > 1:
                return rec_path[1]
            print("  No recommended next stop available -- pick a node id or 'q'.")
            continue

        try:
            node = int(choice)
        except ValueError:
            print("  Enter a node id (number), press Enter for the recommendation, or 'q' to stop.")
            continue

        if node not in feasible_idx:
            print(f"  N{node} isn't feasible right now (time window, or you "
                  f"couldn't get back to depot in time). Pick another.")
            continue

        return node


def interactive_search_visual(env_initial, model, beam_width=16):
    """Google-Maps-style routing on a live, clickable map.

    - Green nodes = feasible right now -- click one to go there.
    - Grey nodes = not reachable from here (time window / can't get back).
    - Gold ring = your current position.
    - Solid blue line = the path you've actually taken.
    - Dashed orange line = the model's recommended route from here onward,
      recomputed after every click (same beam-search logic as the text mode).
    - Buttons let you accept the recommendation with one click, or end the
      route early and head back to the depot.
    """
    env = copy.deepcopy(env_initial)

    static_feats, dynamic_feats = env.get_state()
    if static_feats.dim() == 3:
        static_feats = static_feats.squeeze(0)
        dynamic_feats = dynamic_feats.squeeze(0)

    h_lstm = torch.zeros(1, 128)
    c_lstm = torch.zeros(1, 128)
    prev_h_e = torch.zeros(env.num_nodes, 128)
    current_embedding = torch.zeros(1, 128)

    coords = env.coords.squeeze(0).cpu().numpy() if env.coords.dim() == 3 else env.coords.cpu().numpy()
    rewards_arr = env.rewards.squeeze(0).cpu().numpy() if env.rewards.dim() == 2 else env.rewards.cpu().numpy()

    path = [0]
    total_reward = 0.0
    done = False

    fig, ax = plt.subplots(figsize=(9, 9))
    plt.subplots_adjust(bottom=0.15)

    state = {'chosen_action': None, 'end_route': False, 'feasible_idx': [], 'rec_path': [0]}

    click_radius = 0.08 * (np.ptp(coords) if np.ptp(coords) > 0 else 1.0)

    def on_click(event):
        if event.inaxes != ax or not state['feasible_idx']:
            return
        click_xy = np.array([event.xdata, event.ydata])
        cand = coords[state['feasible_idx']]
        dists = np.linalg.norm(cand - click_xy, axis=1)
        nearest = int(np.argmin(dists))
        if dists[nearest] < click_radius:
            state['chosen_action'] = state['feasible_idx'][nearest]

    def on_follow(event):
        if len(state['rec_path']) > 1:
            state['chosen_action'] = state['rec_path'][1]

    def on_stop(event):
        state['end_route'] = True

    fig.canvas.mpl_connect('button_press_event', on_click)
    btn_follow = Button(plt.axes([0.15, 0.02, 0.3, 0.06]), 'Follow Recommended')
    btn_stop = Button(plt.axes([0.55, 0.02, 0.3, 0.06]), 'End Route -> Depot')
    btn_follow.on_clicked(on_follow)
    btn_stop.on_clicked(on_stop)

    print("\nA map window has opened. Click a GREEN node to route there, or use "
          "the buttons to follow the recommendation or end the route.")

    with torch.no_grad():
        while not done:
            adj_mask = env.get_adjacency_matrix()
            mask = env.get_admissibility_mask()
            if adj_mask.dim() == 3:
                adj_mask = adj_mask.squeeze(0)
            if mask.dim() == 2:
                mask = mask.squeeze(0)

            if not mask.any():
                break

            h_lstm, c_lstm = model.lstm(current_embedding, (h_lstm, c_lstm))
            probs, h_e = model(
                static_feats, dynamic_feats, adj_mask, mask, prev_h_e, (h_lstm, c_lstm)
            )
            if probs.dim() > 1:
                probs = probs.squeeze(0)

            current_node = env.current_node.item()
            feasible_idx = torch.nonzero(mask, as_tuple=False).squeeze(-1).tolist()

            rec_path, rec_reward, rec_time = beam_search(
                env, model, beam_width=beam_width, start_node=current_node,
                initial_lstm_state=(h_lstm, c_lstm),
                initial_prev_h_e=prev_h_e,
                initial_embedding=current_embedding,
            )

            state['feasible_idx'] = feasible_idx
            state['rec_path'] = rec_path
            state['chosen_action'] = None
            state['end_route'] = False

            effective_arr = env.get_effective_rewards()
            effective_arr = effective_arr.squeeze(0).cpu().numpy() if effective_arr.dim() == 2 else effective_arr.cpu().numpy()

            _draw_route_map(ax, coords, effective_arr, path, feasible_idx, rec_path,
                             current_node, env.current_time.item(), total_reward,
                             rec_reward, rec_time)
            fig.canvas.draw()
            plt.pause(0.001)

            while state['chosen_action'] is None and not state['end_route']:
                if not plt.fignum_exists(fig.number):
                    state['end_route'] = True
                    break
                plt.pause(0.1)

            if state['end_route']:
                break

            action = state['chosen_action']
            (static_feats, dynamic_feats), reward, done = env.step(action)
            if static_feats.dim() == 3:
                static_feats = static_feats.squeeze(0)
                dynamic_feats = dynamic_feats.squeeze(0)
            if isinstance(reward, torch.Tensor):
                reward = reward.item()

            path.append(action)
            total_reward += reward
            prev_h_e = h_e.detach()
            current_embedding = h_e[action].unsqueeze(0)

            if getattr(env, "last_step_forecast_updated", False):
                print("  \u26a0\ufe0f  New forecast update! Rewards and evacuation "
                      "deadlines for unvisited places have shifted -- map will "
                      "reflect it next.")

    dist_matrix = env.dist_matrix.squeeze(0) if env.dist_matrix.dim() == 3 else env.dist_matrix
    curr_node = env.current_node.item() if isinstance(env.current_node, torch.Tensor) else env.current_node
    curr_time = env.current_time.item() if isinstance(env.current_time, torch.Tensor) else env.current_time
    return_travel_time = dist_matrix[curr_node, 0].item()
    path.append(0)
    final_time = curr_time + return_travel_time

    if plt.fignum_exists(fig.number):
        _draw_route_map(ax, coords, rewards_arr, path, [], [], curr_node, curr_time,
                         total_reward, total_reward, final_time, finished=True)
        fig.canvas.draw()

    print(f"\nFinal route: " + " -> ".join(f"N{n}" for n in path))
    print(f"Total reward: {total_reward:.1f} | Final time: {final_time:.2f}h")
    print("(Close the map window to continue.)")
    plt.show()

    return path, total_reward, final_time


def _draw_route_map(ax, coords, rewards_arr, path, feasible_idx, rec_path, current_node,
                     current_time, total_reward, rec_reward, rec_time, finished=False):
    ax.clear()
    n = len(coords)
    visited_set = set(path)
    feasible_set = set(feasible_idx)

    other = [i for i in range(n) if i not in visited_set and i not in feasible_set]
    if other:
        ax.scatter(coords[other, 0], coords[other, 1], c='lightgrey', s=60, alpha=0.5,
                   label='Not reachable now', zorder=2)

    if feasible_idx:
        ax.scatter(coords[feasible_idx, 0], coords[feasible_idx, 1], c='#2ecc71', s=200,
                   edgecolors='black', linewidths=1.5, label='Click to go here', zorder=4)

    visited_nodes = list(visited_set - {0})
    if visited_nodes:
        ax.scatter(coords[visited_nodes, 0], coords[visited_nodes, 1], c='dodgerblue', s=140,
                   edgecolors='black', label='Visited', zorder=3)

    ax.scatter([coords[0, 0]], [coords[0, 1]], c='crimson', s=350, marker='*', label='Depot', zorder=5)

    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        ax.annotate("", xy=coords[v], xytext=coords[u],
                    arrowprops=dict(arrowstyle="->", color="dodgerblue", lw=2.5, mutation_scale=15), zorder=3)

    for i in range(len(rec_path) - 1):
        u, v = rec_path[i], rec_path[i + 1]
        ax.annotate("", xy=coords[v], xytext=coords[u],
                    arrowprops=dict(arrowstyle="->", color="darkorange", lw=1.8,
                                     linestyle="dashed", mutation_scale=12), zorder=2)

    for i in range(n):
        ax.text(coords[i, 0] + 0.02, coords[i, 1] + 0.02, f"N{i}(+{rewards_arr[i]:.1f})", fontsize=7)

    if current_node is not None:
        ax.scatter([coords[current_node, 0]], [coords[current_node, 1]], s=420, facecolors='none',
                   edgecolors='gold', linewidths=3, zorder=6, label='You are here')

    title = "Route complete" if finished else f"t = {current_time:.2f}h   |   reward so far: {total_reward:.1f}"
    subtitle = "" if finished else f"Recommended route projects total reward {rec_reward:.1f}, finishing t={rec_time:.2f}h"
    ax.set_title(f"{title}\n{subtitle}", fontsize=11, fontweight='bold')
    ax.set_xlim(coords[:, 0].min() - 0.15, coords[:, 0].max() + 0.15)
    ax.set_ylim(coords[:, 1].min() - 0.15, coords[:, 1].max() + 0.15)
    ax.grid(True, linestyle='--', alpha=0.4)
    ax.legend(loc='upper right', fontsize=8)


def run_optw_pipeline():
    print("=" * 60)
    print("     OPTW ROUTE OPTIMIZER: GREEDY vs BEAM SEARCH      ")
    print("=" * 60)

    try:
        num_nodes = int(input("\nEnter total number of nodes [default 30]: ") or 30)
        max_time = float(input("Enter time budget in hours [default 24.0]: ") or 24.0)
        beam_width = int(input("Enter Beam Width (n_b) [default 32]: ") or 32)
        decay_min = float(input(
            "Enter minimum reward decay fraction, 0-1 -- how much of a node's "
            "reward is still left even if you arrive right at the deadline "
            "[default 0.3]: "
        ) or 0.3)
        forecast_input = input(
            "\nEnable cyclone-style external forecast events? Rewards/deadlines "
            "will shift on their own clock as a simulated hazard track updates, "
            "independent of your movement. [y/N]: "
        ).strip().lower()
        enable_forecast = forecast_input == "y"
        if enable_forecast:
            hazard_radius = float(input("  Hazard danger radius [default 0.4]: ") or 0.4)
            forecast_interval = float(input("  Hours between forecast updates [default 4.0]: ") or 4.0)
            forecast_noise = float(input("  Forecast update noise/uncertainty [default 0.12]: ") or 0.12)
        else:
            hazard_radius, forecast_interval, forecast_noise = 0.4, 4.0, 0.12
        seed_input = input("Enter random seed (or press Enter for random): ")
        env_seed = int(seed_input) if seed_input else None
    except ValueError:
        print("Invalid input! Falling back to defaults: 30 nodes, 24.0h budget, Beam=32, decay floor 0.3, no forecast events.")
        num_nodes, max_time, beam_width, decay_min, env_seed = 30, 24.0, 32, 0.3, None
        enable_forecast, hazard_radius, forecast_interval, forecast_noise = False, 0.4, 4.0, 0.12

    if env_seed is not None:
        torch.manual_seed(env_seed)
        np.random.seed(env_seed)

    env = OPTWEnvironment(
        num_nodes=num_nodes, max_time=max_time, batch_size=1, reward_decay_min=decay_min,
        enable_forecast_events=enable_forecast, hazard_radius=hazard_radius,
        forecast_update_interval=forecast_interval, forecast_noise=forecast_noise,
    )
    env.reset()

    model = PointerNetwork(hidden_dim=128)
    try:
        model.load_state_dict(torch.load("optw_model.pth", map_location="cpu"))
        model.eval()
        print("\n✓ Successfully loaded 'optw_model.pth'")
    except FileNotFoundError:
        print("\n⚠️ Warning: 'optw_model.pth' not found! Executing with un-trained weights.")
    except RuntimeError as e:
        print("\n⚠️ Warning: 'optw_model.pth' doesn't match the current model architecture "
              "(likely an old checkpoint from before dynamic rewards were added). "
              "Run train.py to produce a fresh checkpoint. Executing with un-trained weights "
              f"for now.\n    ({e})")

    mode = input(
        "\nChoose mode:\n"
        "  [1] Greedy vs Beam comparison (original)\n"
        "  [2] Interactive routing -- visual map, click to route (recommended)\n"
        "  [3] Interactive routing -- text only\n"
        "  [4] All of the above\n"
        "Enter choice [default 1]: "
    ).strip() or "1"

    greedy_path = greedy_reward = greedy_time = None
    beam_path = beam_reward = beam_time = None

    if mode in ("1", "4"):
        greedy_path, greedy_reward, greedy_time = greedy_search(env, model)
        beam_path, beam_reward, beam_time = beam_search(env, model, beam_width=beam_width)

        print("\n" + "=" * 60)
        print("                  INFERENCE COMPARISON SUMMARY                 ")
        print("=" * 60)
        print(f"{'Metric':<25} | {'Greedy Search':<15} | {'Beam Search (n_b=' + str(beam_width) + ')':<15}")
        print("-" * 60)
        print(f"{'Total Collected Reward':<25} | {greedy_reward:<15.1f} | {beam_reward:<15.1f}")
        print(f"{'Total Time Spent (hrs)':<25} | {greedy_time:<15.2f} | {beam_time:<15.2f}")
        print(f"{'Targets Visited':<25} | {len(greedy_path)-2:<15} | {len(beam_path)-2:<15}")

        score_diff = beam_reward - greedy_reward
        pct_gain = (score_diff / greedy_reward * 100) if greedy_reward > 0 else 0
        print("-" * 60)
        print(f"Score Improvement with Beam Search: +{score_diff:.1f} pts ({pct_gain:+.2f}%)")
        print("=" * 60)

        print("\nGreedy Path : " + " -> ".join([f"N{n}" for n in greedy_path]))
        print(f"Beam Path   : " + " -> ".join([f"N{n}" for n in beam_path]))

        # Ensure coords and rewards are squeezed to 2D / 1D numpy arrays for plotting
        coords = env.coords.squeeze(0).cpu().numpy() if env.coords.dim() == 3 else env.coords.cpu().numpy()
        rewards = env.rewards.squeeze(0).cpu().numpy() if env.rewards.dim() == 2 else env.rewards.cpu().numpy()

        plot_comparison(coords, rewards, greedy_path, greedy_reward, beam_path, beam_reward, max_time)

    if mode in ("2", "4"):
        int_path, int_reward, int_time = interactive_search_visual(env, model, beam_width=16)
        print("\nInteractive (visual) Path : " + " -> ".join([f"N{n}" for n in int_path]))
        print(f"Interactive (visual) Reward: {int_reward:.1f} | Time: {int_time:.2f}h")

    if mode in ("3", "4"):
        int_path, int_reward, int_time = interactive_search(env, model, beam_width=16)
        print("\nInteractive (text) Path : " + " -> ".join([f"N{n}" for n in int_path]))
        print(f"Interactive (text) Reward: {int_reward:.1f} | Time: {int_time:.2f}h")


def plot_comparison(coords, rewards, greedy_path, greedy_reward, beam_path, beam_reward, max_time):
    fig, axes = plt.subplots(1, 2, figsize=(16, 7))

    paths = [greedy_path, beam_path]
    titles = [f"Greedy Search (Score: {greedy_reward:.1f})", 
              f"Beam Search (Score: {beam_reward:.1f})"]

    for ax, path, title in zip(axes, paths, titles):
        visited_set = set(path)
        unvisited = [i for i in range(len(coords)) if i not in visited_set]

        ax.scatter(coords[unvisited, 0], coords[unvisited, 1], c='lightgrey', s=80, alpha=0.6, label='Unvisited')
        
        visited_nodes = list(visited_set - {0})
        if visited_nodes:
            ax.scatter(coords[visited_nodes, 0], coords[visited_nodes, 1], c='dodgerblue', s=160, edgecolors='black', label='Visited', zorder=4)
        
        ax.scatter(coords[0, 0], coords[0, 1], c='crimson', s=300, marker='*', label='Depot', zorder=5)

        for idx in range(len(path) - 1):
            u, v = path[idx], path[idx + 1]
            ax.annotate("", xy=(coords[v, 0], coords[v, 1]), xytext=(coords[u, 0], coords[u, 1]),
                        arrowprops=dict(arrowstyle="->", color="darkorange", lw=2, mutation_scale=12))

        for i in range(len(coords)):
            ax.text(coords[i, 0] + 0.02, coords[i, 1] + 0.02, f"N{i}(+{int(rewards[i])})", fontsize=8, fontweight='bold')

        ax.set_title(title, fontsize=12, fontweight='bold')
        ax.grid(True, linestyle="--", alpha=0.5)
        ax.legend(loc="upper right")

    plt.suptitle("OPTW Route Inference: Greedy Search vs Beam Search", fontsize=14, fontweight='bold')
    plt.tight_layout()
    
    output_filename = "greedy_vs_beam_comparison.png"
    plt.savefig(output_filename, bbox_inches='tight', dpi=300)
    print(f"\n✓ Comparison plot successfully saved to '{output_filename}'")
    plt.show()


if __name__ == "__main__":
    run_optw_pipeline()