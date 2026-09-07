# OPTW Route Optimizer

A machine learning system that learns to solve dynamic routing problems. Visit as many valuable locations as possible within a time budget and deadline constraints.

**Live Demo:** https://web-mu-two-jcjd89kwmw.vercel.app

---

## 📌 What Is This?

**The Problem:** You have 50 locations to visit, 24 hours, and each location has a deadline. Rewards decrease over time. How do you maximize total reward?

**The Solution:** A Pointer Network trained with REINFORCE (policy gradient RL) learns optimal node selection. At inference, beam search finds near-optimal routes.

**The Stack:**
- **Backend:** PyTorch (training), Python (inference)
- **Frontend:** Next.js, React, Leaflet maps
- **Database:** Turso SQLite
- **Deployment:** Vercel

---

## 🚀 Quick Start

### Train the Model

```bash
pip install torch numpy matplotlib pandas
python train.py
```

Takes ~5-10 min on GPU. Saves weights to `optw_model.pth` and metrics to `training_log.csv`.

### Run Inference

```bash
python run_pipeline.py
```

Compares greedy vs. beam search on a test problem.

### Launch Web App

```bash
cd web && npm install
npm run dev
```

Open http://localhost:3000 → Create a run → Click nodes on the map → See live recommendations.

---

## 📁 Project Structure

```
├── env.py                 # OPTW environment (vectorized, 32 instances parallel)
├── model.py               # Pointer Network + Transformer layers
├── train.py               # REINFORCE trainer (300 epochs)
├── run_pipeline.py        # Greedy & beam search inference
├── optw_model.pth         # Trained weights
├── training_log.csv       # Epoch metrics
│
└── web/                   # Full Next.js app
    ├── src/lib/services/optimizer.service.impl.ts  # Beam search impl
    ├── src/components/route-map.tsx                # Interactive map
    ├── src/components/comparison-view.tsx          # Greedy vs beam
    └── README.md                                   # Web-specific setup
```

---

## 🧠 How It Works

### The Model (Pointer Network)

```
Static Input (coordinates, times, reward) 
    ↓ embed (64-dim)
Dynamic Input (time urgency, decay)
    ↓ embed (64-dim)
    ↓ concat (128-dim)
Transformer Layers (8-head attention with feasibility masking)
    ↓
LSTM (tracks decision history)
    ↓
Pointer Mechanism → output probabilities over all nodes
```

**Key insight:** Pre-softmax masking ensures the model only selects feasible next nodes.

### The Training Loop

```python
for epoch in 300:
    env.reset()  # Random problem
    while episode_active:
        probs = model(state, masks)
        action = sample(probs)
        reward, next_state = env.step(action)
    
    loss = -mean((reward - baseline) × log_probs)
    backprop + grad_clip + optimizer.step()
```

### The Environment

- **50 nodes** on [-1, 1]² grid
- **24-hour time budget** (travel + service)
- **Time-decay rewards:** reward(t) = base × (1 - 0.7 × t/24)
- **Optional:** Exogenous hazard track (simulates forecast updates)
- **Vectorized:** 32 instances trained in parallel

---

## 📊 Results

| Metric | Value |
|--------|-------|
| Training epochs | 300 |
| Greedy avg reward | ~17 |
| Beam (width=16) avg reward | ~22 |
| **Improvement** | **+29%** |
| Greedy inference time | ~5ms |
| Beam inference time | ~50ms |

**Key Findings:**
1. Pointer Network learns constraint handling automatically
2. Beam search essential for high-quality routes
3. Vectorized training: 300 epochs in ~10 min
4. Time-decay modeling improves early-visit prioritization

---

## ⚙️ Configuration

### Change Problem Size

```python
# env.py
self.num_nodes = 50  # → 30, 75, 100, etc.
```

Then retrain: `python train.py`

### Enable Hazard Simulation

```python
# env.py
self.enable_forecast_events = True
```

Now forecasts update every 4 hours with perturbations (non-stationary environment).

### Tune Hyperparameters

```python
# train.py
BATCH_SIZE = 32      # instances per batch
EPOCHS = 300         # training steps
LR = 1e-4           # learning rate
GRAD_CLIP_NORM = 1.0 # gradient clipping
```

---

## 🎮 Using the Web App

1. **Create Run:** Set nodes, time budget, beam width, decay factor
2. **Play:** Click nodes on map → live recommendations update
3. **Score:** See reward, time used, path taken
4. **Compare:** Run greedy vs. beam search from start → see side-by-side results

---

## 🤝 Contributing

**Steps:**
1. Fork repo → create feature branch
2. Make changes (model, algorithm, UI)
3. Test locally: `python train.py` or `cd web && npm run dev`
4. Commit with clear message
5. Submit PR

**Ideas:**
- [ ] Try PPO / A3C instead of REINFORCE
- [ ] Train on 30, 100, 200 node instances
- [ ] Curriculum learning (scale up problem size)
- [ ] Visualize attention weights
- [ ] Real-world road networks (OpenStreetMap)
- [ ] Multi-agent routing
- [ ] Mobile-friendly UI
- [ ] Export routes as GPX

---

## 📚 References

**Papers:**
- Pointer Networks (Vinyals et al. 2015)
- Attention Is All You Need (Vaswani et al. 2017)
- Neural Combinatorial Optimization with RL (Bello et al. 2017)
- Orienteering Problem with Time Windows (Solomon 1987)

**Libraries:**
- [PyTorch](https://pytorch.org)
- [ONNX Runtime](https://onnxruntime.ai)
- [Leaflet](https://leafletjs.com)
- [Next.js](https://nextjs.org)

---

## 📄 License

MIT License

---

## 💬 Questions?

- **Web app setup?** → See [web/README.md](web/README.md)
- **Architecture details?** → Check code comments in `model.py`, `env.py`
- **Bug or feature?** → Open an issue

---

**Happy optimizing! 🚀**
