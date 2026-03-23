# Text Generation WebUI Recipe

One-click deployment of oobabooga's Text Generation WebUI for interactive LLM inference.

## What Gets Installed
- oobabooga/text-generation-webui cloned to /opt/text-generation-webui
- Python virtual environment with PyTorch (CUDA 12.8)
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service                  |
|------|----------|--------------------------|
| 7860 | HTTP     | Text Generation WebUI    |

## Resource Requirements
- **Minimum VRAM**: 4 GB (for small models)
- **Recommended VRAM**: 16 GB+ (for 7B+ parameter models)
- **Disk**: 30 GB + model storage

## Post-Deploy Usage
```bash
# Open the web UI in your browser
http://localhost:7860

# Download and load models through the Model tab in the UI
# Supports GGUF, GPTQ, AWQ, EXL2, and HuggingFace formats
```

## Testing
1. Verify service: `systemctl status text-generation-webui`
2. Verify UI: `curl http://localhost:7860`
3. Load a model via the UI and test generation
