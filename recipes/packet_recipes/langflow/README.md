# Langflow Recipe

One-click deployment of Langflow for visual LLM application building with a drag-and-drop web UI.

## What Gets Installed
- Langflow visual flow builder
- Python virtual environment at /opt/langflow
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service           |
|------|----------|-------------------|
| 7860 | HTTP     | Langflow Web UI   |

## Resource Requirements
- **Minimum RAM**: 4 GB
- **Recommended RAM**: 8 GB+
- **Disk**: 10 GB + flow data storage

## Post-Deploy Usage
```bash
# Access the web UI
open http://localhost:7860

# Check service status
systemctl status langflow
```

## Features
- Visual drag-and-drop flow builder for LLM chains
- Supports OpenAI, Hugging Face, and custom LLM backends
- Built-in prompt engineering tools
- API endpoint generation for each flow

## Testing
1. Verify service: `systemctl status langflow`
2. Verify web UI: `curl http://localhost:7860`
3. Create a simple flow with a prompt and LLM component
