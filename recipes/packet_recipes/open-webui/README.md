# Open WebUI Recipe

One-click deployment of Open WebUI, a ChatGPT-like interface for Ollama and OpenAI-compatible APIs.

## What Gets Installed
- Open WebUI in a Python virtual environment at /opt/open-webui
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service       |
|------|----------|---------------|
| 3000 | HTTP     | Open WebUI    |

## Resource Requirements
- **Minimum RAM**: 2 GB
- **Recommended RAM**: 4 GB+
- **Disk**: 10 GB

## Post-Deploy Usage
```bash
# Open the web UI in your browser
http://localhost:3000

# First visit will prompt you to create an admin account
# Then configure your backend (Ollama URL or OpenAI API key) in Settings
```

## Testing
1. Verify service: `systemctl status open-webui`
2. Verify UI: `curl http://localhost:3000`
3. Create an account and connect to an LLM backend
