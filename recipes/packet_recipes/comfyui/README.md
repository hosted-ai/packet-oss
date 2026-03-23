# ComfyUI Recipe

Node-based Stable Diffusion interface for AI image generation.

## What Gets Installed
- ComfyUI from GitHub
- Python 3 virtual environment with real Python (haishare workaround)
- PyTorch 2.x with CUDA support
- All ComfyUI dependencies
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service    |
|------|----------|------------|
| 8188 | HTTP     | ComfyUI UI |

## Resource Requirements
- **Minimum VRAM**: 8 GB
- **Recommended VRAM**: 24 GB
- **Disk**: 20 GB + model storage (models can be 2-10 GB each)

## Post-Deploy Usage
Access ComfyUI at `http://<pod-ip>:8188`

### Download models
Place models in the appropriate directories:
- Checkpoints: `/opt/ComfyUI/models/checkpoints/`
- LoRA: `/opt/ComfyUI/models/loras/`
- VAE: `/opt/ComfyUI/models/vae/`
- ControlNet: `/opt/ComfyUI/models/controlnet/`

## Testing
1. Verify service: `systemctl status comfyui`
2. Verify web UI: `curl -s http://localhost:8188 | head -5`
3. Check GPU: `source /opt/ComfyUI/venv/bin/activate && python -c "import torch; print(torch.cuda.is_available())"`
