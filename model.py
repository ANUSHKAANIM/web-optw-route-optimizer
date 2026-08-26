import torch
import torch.nn as nn
import torch.nn.functional as F

class GraphRecursiveTransformerLayer(nn.Module):
    def __init__(self, hidden_dim=128, n_heads=8):
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = hidden_dim // n_heads
        
        self.W_q = nn.Linear(hidden_dim, hidden_dim)
        self.W_k = nn.Linear(hidden_dim, hidden_dim)
        self.W_v = nn.Linear(hidden_dim, hidden_dim)
        self.W_out = nn.Linear(hidden_dim, hidden_dim)
        
        self.ffn = nn.Sequential(
            nn.Linear(hidden_dim, 256),
            nn.ReLU(),
            nn.Linear(256, hidden_dim)
        )
        self.norm1 = nn.LayerNorm(hidden_dim)
        self.norm2 = nn.LayerNorm(hidden_dim)

    def forward(self, x, prev_h, adj_mask):
        # Supports 2D (N, d) or 3D (B, N, d) inputs
        if x.dim() == 2:
            x = x.unsqueeze(0)
            prev_h = prev_h.unsqueeze(0)
            adj_mask = adj_mask.unsqueeze(0)
            squeeze_output = True
        else:
            squeeze_output = False

        B, N, _ = x.shape
        
        Q = self.W_q(x).view(B, N, self.n_heads, self.head_dim).transpose(1, 2)
        K = self.W_k(prev_h).view(B, N, self.n_heads, self.head_dim).transpose(1, 2)
        V = self.W_v(x).view(B, N, self.n_heads, self.head_dim).transpose(1, 2)
        
        scores = torch.matmul(Q, K.transpose(-2, -1)) / (self.head_dim ** 0.5)
        
        adj_mask_expanded = adj_mask.unsqueeze(1).expand(-1, self.n_heads, -1, -1)
        scores = scores.masked_fill(~adj_mask_expanded, float('-inf'))
        
        attn = F.softmax(scores, dim=-1)
        attn = torch.nan_to_num(attn, 0.0)
        
        context = torch.matmul(attn, V).transpose(1, 2).contiguous().view(B, N, -1)
        x_attn = self.norm1(x + self.W_out(context))
        out = self.norm2(x_attn + self.ffn(x_attn))
        
        return out.squeeze(0) if squeeze_output else out


class PointerNetwork(nn.Module):
    def __init__(self, hidden_dim=128):
        super().__init__()
        self.hidden_dim = hidden_dim
        
        self.W_st = nn.Linear(7, hidden_dim // 2)
        self.W_dy = nn.Linear(9, hidden_dim // 2)
        
        self.layer1 = GraphRecursiveTransformerLayer(hidden_dim)
        self.layer2 = GraphRecursiveTransformerLayer(hidden_dim)
        
        self.lstm = nn.LSTMCell(hidden_dim, hidden_dim)
        
        self.W_1 = nn.Linear(hidden_dim, hidden_dim)
        self.W_2 = nn.Linear(hidden_dim, hidden_dim)
        self.w = nn.Parameter(torch.FloatTensor(hidden_dim))
        self.w.data.uniform_(-1 / (hidden_dim**0.5), 1 / (hidden_dim**0.5))

    def forward(self, static_feats, dynamic_feats, adj_mask, mask, prev_h_e, lstm_state):
        is_batched = static_feats.dim() == 3
        if not is_batched:
            static_feats = static_feats.unsqueeze(0)
            dynamic_feats = dynamic_feats.unsqueeze(0)
            adj_mask = adj_mask.unsqueeze(0)
            mask = mask.unsqueeze(0)
            prev_h_e = prev_h_e.unsqueeze(0)

        # 1. Feature embedding
        h_st = torch.tanh(self.W_st(static_feats))
        h_dy = torch.tanh(self.W_dy(dynamic_feats))
        e = torch.cat([h_st, h_dy], dim=-1)
        
        # 2. Transformer set encoding with recursion
        h1 = self.layer1(e, prev_h_e, adj_mask)
        h_e = self.layer2(h1, prev_h_e, adj_mask)
        
        # 3. Pointing mechanism
        h_d, _ = lstm_state
        if h_d.dim() == 1:
            h_d = h_d.unsqueeze(0)

        q = self.W_2(h_d)             # (B, hidden_dim)
        ref = self.W_1(h_e)           # (B, N, hidden_dim)
        
        u = torch.sum(self.w * torch.tanh(ref + q.unsqueeze(1)), dim=-1)  # (B, N)
        u = 10.0 * torch.tanh(u)      # C-tanh bounding
        
        u = u.masked_fill(~mask, float('-inf'))
        probs = F.softmax(u, dim=-1)
        
        # Fill NaN values with 0.0 for dead paths where mask is entirely False
        probs = torch.nan_to_num(probs, nan=0.0)

        if not is_batched:
            return probs.squeeze(0), h_e.squeeze(0)
        return probs, h_e