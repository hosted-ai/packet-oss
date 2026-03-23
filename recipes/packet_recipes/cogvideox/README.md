# CogVideoX Recipe

One-click deployment of CogVideoX for text-to-video generation with a Gradio web UI.

## What Gets Installed
- CogVideoX (THUDM/CogVideo) with diffusers pipeline
- Gradio web interface for text-to-video generation
- PyTorch with CUDA 12.8 support
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service          |
|------|----------|------------------|
| 7860 | HTTP     | Gradio Web UI    |

## Resource Requirements
- **Minimum VRAM**: 8 GB (CogVideoX-2b with CPU offload)
- **Recommended VRAM**: 24 GB+ (for faster generation)
- **Disk**: 40 GB + model storage

## Post-Deploy Usage
```bash
# Access the web UI
open http://localhost:7860

# Check service status
systemctl status cogvideox
```

## Testing
1. Verify service: `systemctl status cogvideox`
2. Verify web UI: `curl http://localhost:7860`
3. Enter a prompt in the web UI and generate a video
