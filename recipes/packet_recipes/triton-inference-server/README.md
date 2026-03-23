# Triton Inference Server Recipe

One-click deployment of a Triton-compatible inference server with FastAPI.

## What Gets Installed
- Python virtual environment at /opt/triton
- PyTorch, Transformers, FastAPI, Uvicorn, Triton Client
- FastAPI server mimicking NVIDIA Triton v2 API
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service                  |
|------|----------|--------------------------|
| 8000 | HTTP     | Triton Inference Server  |

## Resource Requirements
- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 16 GB+ (for larger models)
- **Disk**: 20 GB + model storage

## Post-Deploy Usage
```bash
# Health check
curl http://localhost:8000/v2/health/ready

# Model inference
curl -X POST http://localhost:8000/v2/models/my_model/infer \
  -H "Content-Type: application/json" \
  -d '{"inputs": [{"name": "input", "shape": [1], "datatype": "FP32", "data": [1.0]}]}'
```

## Testing
1. Verify service: `systemctl status triton-inference-server`
2. Verify API: `curl http://localhost:8000/v2/health/ready`
3. Server metadata: `curl http://localhost:8000/v2`
