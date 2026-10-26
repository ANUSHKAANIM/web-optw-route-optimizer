import random
import time

import torch
import torch.optim as optim
from env import OPTWEnvironment
from model import PointerNetwork

# Domain randomization: every epoch trains on a freshly generated scenario
# (a different node count, and -- since env.reset() now randomizes
# per-batch-element too -- 32 different random instances of that size) so
# the policy learns general routing/decision-making rather than overfitting
# one fixed 50-node layout. Range chosen to comfortably cover both today's
# smaller synthetic instances and the ~80-node real Delhi graph.
MIN_NODES = 15
MAX_NODES = 90


def train():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on device: {device}")

    batch_size = 32
    epochs = 3000
    checkpoint_every = 300

    model = PointerNetwork(hidden_dim=128).to(device)
    optimizer = optim.Adam(model.parameters(), lr=1e-4)

    running_reward = None
    start = time.time()

    for epoch in range(epochs):
        num_nodes = random.randint(MIN_NODES, MAX_NODES)
        env = OPTWEnvironment(num_nodes=num_nodes, batch_size=batch_size, device=device)
        static_feats, dynamic_feats = env.reset(same_instance=False)

        h_lstm = torch.zeros(batch_size, 128, device=device)
        c_lstm = torch.zeros(batch_size, 128, device=device)
        prev_h_e = torch.zeros(batch_size, num_nodes, 128, device=device)
        current_embedding = torch.zeros(batch_size, 128, device=device)

        batch_log_probs = torch.zeros(batch_size, device=device)
        total_rewards = torch.zeros(batch_size, device=device)
        active_mask = torch.ones(batch_size, dtype=torch.bool, device=device)

        while active_mask.any():
            adj_mask = env.get_adjacency_matrix()
            mask = env.get_admissibility_mask()

            # Deactivate trajectories that have no valid moves left
            has_valid_move = mask.any(dim=-1)
            active_mask = active_mask & has_valid_move

            if not active_mask.any():
                break

            h_lstm, c_lstm = model.lstm(current_embedding, (h_lstm, c_lstm))
            probs, h_e = model(static_feats, dynamic_feats, adj_mask, mask, prev_h_e, (h_lstm, c_lstm))

            # Add epsilon to active distributions and zero out completed routes
            sampling_probs = (probs + 1e-8) * active_mask.unsqueeze(-1).float()
            
            # Fallback uniform probability for completed routes to satisfy multinomial requirements
            dead_routes = ~active_mask
            if dead_routes.any():
                sampling_probs[dead_routes] = 1.0 / num_nodes

            actions = torch.multinomial(sampling_probs, 1).squeeze(-1) # (B,)
            
            # Collect log probs only for active trajectories
            selected_probs = probs[torch.arange(batch_size), actions]
            log_p = torch.log(selected_probs + 1e-8)
            batch_log_probs += log_p * active_mask.float()

            (static_feats, dynamic_feats), reward, _ = env.step(actions)
            total_rewards += reward * active_mask.float()

            prev_h_e = h_e.detach()
            current_embedding = h_e[torch.arange(batch_size), actions]

        # REINFORCE gradient update
        baseline = total_rewards.mean()
        loss = -((total_rewards - baseline) * batch_log_probs).mean()

        optimizer.zero_grad()
        if loss.requires_grad and not torch.isnan(loss):
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

        reward_per_node = baseline.item() / num_nodes
        running_reward = reward_per_node if running_reward is None else 0.98 * running_reward + 0.02 * reward_per_node

        if epoch % 10 == 0:
            elapsed = time.time() - start
            print(
                f"Epoch {epoch:04d} | N={num_nodes:3d} | Avg Reward: {baseline.item():7.2f} "
                f"| Reward/Node (EMA): {running_reward:.4f} | Loss: {loss.item():.4f} | {elapsed:.0f}s",
                flush=True,
            )

        if epoch > 0 and epoch % checkpoint_every == 0:
            torch.save(model.state_dict(), "optw_model.pth")
            print(f"  (checkpoint saved at epoch {epoch})", flush=True)

    torch.save(model.to("cpu").state_dict(), "optw_model.pth")
    print("✓ Vectorized training complete. Saved to 'optw_model.pth'")

if __name__ == "__main__":
    train()