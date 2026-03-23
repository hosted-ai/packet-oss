# Jupyter + PyTorch Recipe

Full GPU-accelerated Python development environment with JupyterLab and PyTorch.

## What Gets Installed
- Python 3 virtual environment with real Python (haishare workaround)
- PyTorch 2.x with CUDA support (nightly, cu128)
- JupyterLab with extensions (git integration, widgets)
- ML libraries: transformers, datasets, accelerate, tensorboard
- Data science: numpy, pandas, matplotlib, plotly, scipy, scikit-learn
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service    |
|------|----------|------------|
| 8888 | HTTP     | JupyterLab |

## Resource Requirements
- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 16 GB
- **Disk**: 20 GB + datasets

## Post-Deploy Usage
Access JupyterLab at `http://<pod-ip>:8888`

Verify GPU access in a notebook:
```python
import torch
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0))
```

## Testing
1. Verify service: `systemctl status jupyter-pytorch`
2. Verify web UI: `curl -s http://localhost:8888`
3. Verify PyTorch GPU: `source /opt/jupyter-env/bin/activate && python -c "import torch; print(torch.cuda.is_available())"`
