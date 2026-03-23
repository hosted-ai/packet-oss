# Fooocus Recipe

One-click deployment of Fooocus for simplified AI image generation.

## What Gets Installed
- Fooocus at /opt/fooocus
- Python virtual environment with PyTorch (CUDA 12.8)
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service       |
|------|----------|---------------|
| 7865 | HTTP     | Fooocus WebUI |

## Resource Requirements
- **Minimum VRAM**: 4 GB (basic generation)
- **Recommended VRAM**: 8 GB+ (SDXL quality, inpainting)
- **Disk**: 30 GB + model storage

## Post-Deploy Usage
```bash
# Open WebUI in browser
http://localhost:7865
```

Fooocus provides a streamlined Gradio-based UI. Simply navigate to the WebUI and start generating images with text prompts. Models are downloaded automatically on first use.

## Testing
1. Verify service: `systemctl status fooocus`
2. Open WebUI: `http://localhost:7865`
3. View logs: `journalctl -u fooocus -f`
