# OPTW Reinforcement Learning Project

This project implements a Reinforcement Learning approach to solve the Orienteering Problem with Time Windows (OPTW).

## Overview
This repository contains the training code, model architecture, and performance logs for a Pointer Network-based agent trained to optimize path selection within specified time windows.

## Performance Metrics

### Reward Curve
![Reward Curve](reward_curve.png)

### Loss Curve
![Loss Curve](loss_curve.png)

## Files Included
- `train.py`: The main training script.
- `model.py`: Pointer Network architecture.
- `env.py`: The OPTW environment definition.
- `training_log.csv`: Detailed logs of training epochs.
- `optw_model.pth`: The trained model weights.

## Web App

A production-ready Next.js web app (interactive click-to-route map, run
history, training metrics dashboard) built on top of this model lives in
[`web/`](web/README.md) and is deployable on Vercel. It runs the trained
model via an exported ONNX file — see [web/README.md](web/README.md) for
architecture, setup, and deployment instructions.

## How to Run
1. Ensure you have the required dependencies installed (PyTorch, Matplotlib, etc.).
2. Run the training script:
   ```bash
   python train.py
