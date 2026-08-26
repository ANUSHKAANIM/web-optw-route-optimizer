"""One-off export of the trained PointerNetwork checkpoint to ONNX.

Run once (or whenever optw_model.pth changes) from the repo root, using the
project's rl_env virtualenv:

    ./rl_env/Scripts/python.exe model/export_to_onnx.py

Produces model/optw_model.onnx, consumed by the Next.js app's inference
service (lib/services/inference.service.ts) via onnxruntime-node. The web
app never imports PyTorch -- this script is the only bridge between the
Python training code and the TypeScript serving code.
"""
import os
import sys

import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from model import PointerNetwork  # noqa: E402

HIDDEN_DIM = 128
EXPORT_NODE_COUNT = 50  # example/trace shape only; node-count axis is dynamic in the export


class PointerNetworkStep(nn.Module):
    """Wraps one full decision step (LSTM cell update + pointing network) as
    a single graph, since the two are always invoked back-to-back at
    inference time. This is the unit the web app calls once per node visited."""

    def __init__(self, inner: PointerNetwork):
        super().__init__()
        self.inner = inner

    def forward(self, static_feats, dynamic_feats, adj_mask, mask, prev_h_e, current_embedding, h_lstm, c_lstm):
        new_h, new_c = self.inner.lstm(current_embedding, (h_lstm, c_lstm))
        probs, h_e = self.inner(static_feats, dynamic_feats, adj_mask, mask, prev_h_e, (new_h, new_c))
        return probs, h_e, new_h, new_c


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    checkpoint_path = os.path.join(repo_root, "optw_model.pth")
    # Written directly into web/model/ (inside the deployable Next.js app root)
    # so Vercel's build picks it up -- NOT into this model/ folder, which sits
    # outside the app root and would not be deployed.
    output_path = os.path.join(repo_root, "web", "model", "optw_model.onnx")

    model = PointerNetwork(hidden_dim=HIDDEN_DIM)
    model.load_state_dict(torch.load(checkpoint_path, map_location="cpu"))
    model.eval()

    step_model = PointerNetworkStep(model)

    n = EXPORT_NODE_COUNT
    example_inputs = (
        torch.zeros(1, n, 7),        # static_feats
        torch.zeros(1, n, 9),        # dynamic_feats
        torch.ones(1, n, n, dtype=torch.bool),   # adj_mask
        torch.ones(1, n, dtype=torch.bool),      # mask
        torch.zeros(1, n, HIDDEN_DIM),           # prev_h_e
        torch.zeros(1, HIDDEN_DIM),              # current_embedding
        torch.zeros(1, HIDDEN_DIM),              # h_lstm
        torch.zeros(1, HIDDEN_DIM),              # c_lstm
    )

    dynamic_axes = {
        "static_feats": {1: "num_nodes"},
        "dynamic_feats": {1: "num_nodes"},
        "adj_mask": {1: "num_nodes", 2: "num_nodes"},
        "mask": {1: "num_nodes"},
        "prev_h_e": {1: "num_nodes"},
        "probs": {1: "num_nodes"},
        "h_e_out": {1: "num_nodes"},
    }

    torch.onnx.export(
        step_model,
        example_inputs,
        output_path,
        input_names=[
            "static_feats", "dynamic_feats", "adj_mask", "mask",
            "prev_h_e", "current_embedding", "h_lstm", "c_lstm",
        ],
        output_names=["probs", "h_e_out", "h_lstm_out", "c_lstm_out"],
        dynamic_axes=dynamic_axes,
        opset_version=17,
        dynamo=False,
    )

    print(f"Exported ONNX model to {output_path}")


if __name__ == "__main__":
    main()
