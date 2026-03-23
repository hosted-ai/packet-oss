# vLLM V1 + TinyLlama Recipe

Production-ready vLLM V1 inference server with TinyLlama 1.1B pre-loaded.

## What Gets Installed
- Python 3 virtual environment with real Python (haishare workaround)
- vLLM with V1 engine enabled
- TinyLlama 1.1B Chat model (auto-downloads on first start)
- OpenAI-compatible API server
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service                    |
|------|----------|----------------------------|
| 8000 | HTTP     | OpenAI-compatible API      |

## Resource Requirements
- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Disk**: 15 GB + model storage (~2 GB for TinyLlama)

## Post-Deploy Usage

### Test the API
```bash
# List models
curl http://localhost:8000/v1/models

# Chat completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}'
```

### Run test script
```bash
/opt/test-vllm.sh
```

## Testing
1. Verify service: `systemctl status vllm-v1-tinyllama`
2. Verify API: `curl http://localhost:8000/v1/models`
3. Run test: `/opt/test-vllm.sh`
