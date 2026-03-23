# Ollama Recipe

One-click deployment of Ollama for local LLM inference.

## What Gets Installed
- Ollama runtime with GPU support
- Systemd service (auto-starts on boot)

## Ports
| Port  | Protocol | Service     |
|-------|----------|-------------|
| 11434 | HTTP     | Ollama API  |

## Resource Requirements
- **Minimum VRAM**: 4 GB (for small models like TinyLlama)
- **Recommended VRAM**: 16 GB+ (for 7B+ parameter models)
- **Disk**: 20 GB + model storage

## Post-Deploy Usage
```bash
# Pull a model
ollama pull llama3.2

# Chat
ollama run llama3.2

# API usage
curl http://localhost:11434/api/generate -d '{"model": "llama3.2", "prompt": "Hello!"}'
```

## Testing
1. Verify service: `systemctl status ollama`
2. Verify API: `curl http://localhost:11434/api/tags`
3. Pull and test a model: `ollama run tinyllama "Hello"`
