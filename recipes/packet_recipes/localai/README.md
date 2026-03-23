# LocalAI Recipe

One-click deployment of LocalAI for OpenAI-compatible local inference.

## What Gets Installed
- LocalAI binary at /usr/local/bin/local-ai
- Models directory at /opt/localai/models
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service    |
|------|----------|------------|
| 8080 | HTTP     | LocalAI API |

## Resource Requirements
- **Minimum VRAM**: 4 GB (for small models)
- **Recommended VRAM**: 16 GB+ (for 7B+ parameter models)
- **Disk**: 20 GB + model storage

## Post-Deploy Usage
```bash
# Check readiness
curl http://localhost:8080/readyz

# List models
curl http://localhost:8080/v1/models

# Chat completion (OpenAI-compatible)
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## Testing
1. Verify service: `systemctl status localai`
2. Verify API: `curl http://localhost:8080/readyz`
3. List models: `curl http://localhost:8080/v1/models`
