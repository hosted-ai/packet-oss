# HuggingFace TGI Recipe

One-click deployment of a HuggingFace Text Generation Inference server using transformers and FastAPI.

## What Gets Installed
- Python virtual environment at /opt/tgi with torch, transformers, accelerate, FastAPI, uvicorn
- FastAPI inference server script at /opt/tgi/server.py
- Systemd service (auto-starts on boot)
- Configurable model (default: TinyLlama/TinyLlama-1.1B-Chat-v1.0)

## Ports
| Port | Protocol | Service     |
|------|----------|-------------|
| 8080 | HTTP     | TGI API     |

## Resource Requirements
- **Minimum VRAM**: 4 GB (for small models like TinyLlama)
- **Recommended VRAM**: 24 GB+ (for 7B+ parameter models)
- **Disk**: 30 GB + model storage

## Post-Deploy Usage
```bash
# Health check
curl http://localhost:8080/health

# Generate text
curl -X POST "http://localhost:8080/generate?prompt=Hello+world&max_new_tokens=50"

# Interactive API docs
http://localhost:8080/docs
```

## Testing
1. Verify service: `systemctl status huggingface-tgi`
2. Verify health: `curl http://localhost:8080/health`
3. Test generation: `curl -X POST "http://localhost:8080/generate?prompt=Hello&max_new_tokens=20"`
