# Kohya SS Recipe

One-click deployment of Kohya SS for Stable Diffusion model training with a Gradio web UI.

## What Gets Installed
- Kohya SS (bmaltais/kohya_ss) training GUI
- PyTorch with CUDA 12.8 support
- xformers, bitsandbytes, and accelerate
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service          |
|------|----------|------------------|
| 7860 | HTTP     | Kohya SS Web UI  |

## Resource Requirements
- **Minimum VRAM**: 8 GB (for LoRA training)
- **Recommended VRAM**: 16 GB+ (for DreamBooth and full fine-tuning)
- **Disk**: 30 GB + model and training data storage

## Post-Deploy Usage
```bash
# Access the web UI
open http://localhost:7860

# Check service status
systemctl status kohya-ss
```

## Supported Training Methods
- LoRA / LoHA / LoKr
- DreamBooth
- Fine-tuning
- Textual Inversion

## Testing
1. Verify service: `systemctl status kohya-ss`
2. Verify web UI: `curl http://localhost:7860`
3. Upload training images and configure a LoRA training run
