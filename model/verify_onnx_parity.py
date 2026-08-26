"""Sanity check: run one greedy-search trajectory through the PyTorch model
and through the exported ONNX model on the same seeded instance, and assert
the chosen path and total reward match exactly. Run after every re-export.

    ./rl_env/Scripts/python.exe model/verify_onnx_parity.py
"""
import os
import sys

import numpy as np
import onnxruntime as ort
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from env import OPTWEnvironment  # noqa: E402
from model import PointerNetwork  # noqa: E402

HIDDEN_DIM = 128


def run_pytorch(env, model):
    static_feats, dynamic_feats = env.get_state()
    static_feats, dynamic_feats = static_feats.squeeze(0), dynamic_feats.squeeze(0)
    h_lstm, c_lstm = torch.zeros(1, HIDDEN_DIM), torch.zeros(1, HIDDEN_DIM)
    prev_h_e = torch.zeros(env.num_nodes, HIDDEN_DIM)
    current_embedding = torch.zeros(1, HIDDEN_DIM)
    path, total_reward, done = [0], 0.0, False

    with torch.no_grad():
        while not done:
            adj_mask = env.get_adjacency_matrix().squeeze(0)
            mask = env.get_admissibility_mask().squeeze(0)
            if not mask.any():
                break
            h_lstm, c_lstm = model.lstm(current_embedding, (h_lstm, c_lstm))
            probs, h_e = model(static_feats, dynamic_feats, adj_mask, mask, prev_h_e, (h_lstm, c_lstm))
            action = torch.argmax(probs).item()
            (static_feats, dynamic_feats), reward, done = env.step(action)
            static_feats, dynamic_feats = static_feats.squeeze(0), dynamic_feats.squeeze(0)
            path.append(action)
            total_reward += reward
            prev_h_e = h_e.detach()
            current_embedding = h_e[action].unsqueeze(0)
    return path, total_reward


def run_onnx(env, session):
    static_feats, dynamic_feats = env.get_state()
    static_feats = static_feats.numpy().astype(np.float32)
    dynamic_feats = dynamic_feats.numpy().astype(np.float32)
    h_lstm = np.zeros((1, HIDDEN_DIM), dtype=np.float32)
    c_lstm = np.zeros((1, HIDDEN_DIM), dtype=np.float32)
    prev_h_e = np.zeros((1, env.num_nodes, HIDDEN_DIM), dtype=np.float32)
    current_embedding = np.zeros((1, HIDDEN_DIM), dtype=np.float32)
    path, total_reward, done = [0], 0.0, False

    while not done:
        adj_mask = env.get_adjacency_matrix().numpy()
        mask = env.get_admissibility_mask().numpy()
        if not mask.any():
            break
        probs, h_e, h_lstm, c_lstm = session.run(
            ["probs", "h_e_out", "h_lstm_out", "c_lstm_out"],
            {
                "static_feats": static_feats, "dynamic_feats": dynamic_feats,
                "adj_mask": adj_mask, "mask": mask, "prev_h_e": prev_h_e,
                "current_embedding": current_embedding, "h_lstm": h_lstm, "c_lstm": c_lstm,
            },
        )
        action = int(np.argmax(probs[0]))
        (static_feats_t, dynamic_feats_t), reward, done = env.step(action)
        static_feats = static_feats_t.numpy().astype(np.float32)
        dynamic_feats = dynamic_feats_t.numpy().astype(np.float32)
        path.append(action)
        total_reward += reward
        prev_h_e = h_e
        current_embedding = h_e[:, action, :]
    return path, total_reward


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    torch.manual_seed(42)

    env_torch = OPTWEnvironment(num_nodes=30, max_time=24.0, batch_size=1)
    env_torch.reset()
    env_onnx = OPTWEnvironment(num_nodes=30, max_time=24.0, batch_size=1)
    env_onnx.coords = env_torch.coords.clone()
    env_onnx.dist_matrix = env_torch.dist_matrix.clone()
    env_onnx.opening_times = env_torch.opening_times.clone()
    env_onnx.durations = env_torch.durations.clone()
    env_onnx.closing_times = env_torch.closing_times.clone()
    env_onnx.rewards = env_torch.rewards.clone()
    env_onnx.S_max = env_torch.S_max
    env_onnx.reset(same_instance=True)

    model = PointerNetwork(hidden_dim=HIDDEN_DIM)
    model.load_state_dict(torch.load(os.path.join(repo_root, "optw_model.pth"), map_location="cpu"))
    model.eval()

    session = ort.InferenceSession(os.path.join(repo_root, "web", "model", "optw_model.onnx"))

    path_pt, reward_pt = run_pytorch(env_torch, model)
    path_onnx, reward_onnx = run_onnx(env_onnx, session)

    print(f"PyTorch path: {path_pt}  reward={reward_pt:.4f}")
    print(f"ONNX    path: {path_onnx}  reward={reward_onnx:.4f}")

    assert path_pt == path_onnx, "Path mismatch between PyTorch and ONNX!"
    assert abs(reward_pt - reward_onnx) < 1e-3, "Reward mismatch between PyTorch and ONNX!"
    print("\n✓ ONNX export matches PyTorch model exactly.")


if __name__ == "__main__":
    main()
