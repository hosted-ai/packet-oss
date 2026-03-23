# vLLM Server Recipe

One-click deployment of vLLM for OpenAI-compatible LLM inference serving.

## What Gets Installed
- vLLM inference server in a Python virtual environment at /opt/vllm
- Systemd service (auto-starts on boot)
- Configurable model (default: TinyLlama/TinyLlama-1.1B-Chat-v1.0)

## Ports
| Port | Protocol | Service          |
|------|----------|------------------|
| 8000 | HTTP     | vLLM OpenAI API  |

## Resource Requirements
- **Minimum VRAM**: 4 GB (for small models like TinyLlama)
- **Recommended VRAM**: 24 GB+ (for 7B+ parameter models)
- **Disk**: 30 GB + model storage

## Post-Deploy Usage
```bash
# Chat completions (OpenAI-compatible)
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "messages": [{"role": "user", "content": "Hello!"}]}'

# List models
curl http://localhost:8000/v1/models
```

## Testing
1. Verify service: `systemctl status vllm`
2. Verify API: `curl http://localhost:8000/v1/models`
3. Test inference: `curl http://localhost:8000/v1/completions -d '{"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "prompt": "Hello"}'`
