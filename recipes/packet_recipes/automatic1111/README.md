# AUTOMATIC1111 Stable Diffusion WebUI Recipe

One-click deployment of AUTOMATIC1111 Stable Diffusion WebUI for AI image generation.

## What Gets Installed
- AUTOMATIC1111 stable-diffusion-webui at /opt/automatic1111
- Python virtual environment with PyTorch (CUDA 12.8)
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service                          |
|------|----------|----------------------------------|
| 7860 | HTTP     | Stable Diffusion WebUI + API     |

## Resource Requirements
- **Minimum VRAM**: 4 GB (SD 1.5 at 512x512)
- **Recommended VRAM**: 8 GB+ (SDXL, higher resolutions)
- **Disk**: 30 GB + model storage

## Post-Deploy Usage
```bash
# Open WebUI in browser
http://localhost:7860

# API - Text to Image
curl -X POST http://localhost:7860/sdapi/v1/txt2img \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a photo of a cat", "steps": 20, "width": 512, "height": 512}'

# API - Check options
curl http://localhost:7860/sdapi/v1/options
```

## Testing
1. Verify service: `systemctl status automatic1111`
2. Verify API: `curl http://localhost:7860/sdapi/v1/options`
3. Open WebUI: `http://localhost:7860`
