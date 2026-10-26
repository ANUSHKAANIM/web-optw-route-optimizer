"""Compares two PointerNetwork checkpoints (e.g. the old production model vs
a newly retrained one) via greedy-rollout total reward across a fixed set of
seeded instances spanning several node counts -- including 80, matching the
real Delhi deployment size.

    ./rl_env/Scripts/python.exe model/evaluate_models.py <old.pth> <new.pth>
"""
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from env import OPTWEnvironment  # noqa: E402
from model import PointerNetwork  # noqa: E402

HIDDEN_DIM = 128
NODE_COUNTS = [20, 35, 50, 65, 80, 80, 80]
SEEDS = [1, 2, 3, 4, 5, 6, 7]


def load_model(path):
    model = PointerNetwork(hidden_dim=HIDDEN_DIM)
    model.load_state_dict(torch.load(path, map_location="cpu"))
    model.eval()
    return model


def greedy_rollout(model, num_nodes, seed, max_time=24.0):
    torch.manual_seed(seed)
    env = OPTWEnvironment(num_nodes=num_nodes, max_time=max_time, batch_size=1)
    static_feats, dynamic_feats = env.reset()

    h_lstm, c_lstm = torch.zeros(1, HIDDEN_DIM), torch.zeros(1, HIDDEN_DIM)
    prev_h_e = torch.zeros(num_nodes, HIDDEN_DIM)
    current_embedding = torch.zeros(1, HIDDEN_DIM)
    total_reward, done, steps = 0.0, False, 0

    with torch.no_grad():
        while not done and steps < num_nodes + 5:
            adj_mask = env.get_adjacency_matrix().squeeze(0)
            mask = env.get_admissibility_mask().squeeze(0)
            if not mask.any():
                break
            h_lstm, c_lstm = model.lstm(current_embedding, (h_lstm, c_lstm))
            probs, h_e = model(
                static_feats.squeeze(0), dynamic_feats.squeeze(0), adj_mask, mask, prev_h_e, (h_lstm, c_lstm)
            )
            action = torch.argmax(probs).item()
            (static_feats, dynamic_feats), reward, done = env.step(action)
            total_reward += reward
            prev_h_e = h_e.detach()
            current_embedding = h_e[action].unsqueeze(0)
            steps += 1

    return total_reward, steps


def evaluate(model, label):
    print(f"\n{label}")
    total, total_per_node = 0.0, 0.0
    for num_nodes, seed in zip(NODE_COUNTS, SEEDS):
        reward, steps = greedy_rollout(model, num_nodes, seed)
        per_node = reward / num_nodes
        total += reward
        total_per_node += per_node
        print(f"  N={num_nodes:3d} seed={seed} | reward={reward:7.2f} | steps={steps:2d} | reward/node={per_node:.3f}")
    n = len(NODE_COUNTS)
    print(f"  --> avg reward={total / n:.2f}  avg reward/node={total_per_node / n:.3f}")
    return total / n, total_per_node / n


def main():
    if len(sys.argv) != 3:
        print("Usage: evaluate_models.py <old.pth> <new.pth>")
        sys.exit(1)

    old_path, new_path = sys.argv[1], sys.argv[2]
    old_model = load_model(old_path)
    new_model = load_model(new_path)

    old_avg, old_avg_pn = evaluate(old_model, f"OLD model ({old_path})")
    new_avg, new_avg_pn = evaluate(new_model, f"NEW model ({new_path})")

    print("\n=== Summary ===")
    print(f"OLD: avg reward={old_avg:.2f}  avg reward/node={old_avg_pn:.3f}")
    print(f"NEW: avg reward={new_avg:.2f}  avg reward/node={new_avg_pn:.3f}")
    delta_pct = ((new_avg_pn - old_avg_pn) / max(abs(old_avg_pn), 1e-6)) * 100
    print(f"Change in avg reward/node: {delta_pct:+.1f}%")


if __name__ == "__main__":
    main()
