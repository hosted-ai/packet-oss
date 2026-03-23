# VS Code Server (code-server) Recipe

One-click deployment of VS Code in the browser with GPU access.

## What Gets Installed
- code-server (VS Code in browser)
- Python and Jupyter extensions
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service         |
|------|----------|-----------------|
| 8080 | HTTP     | VS Code Web IDE |

## Resource Requirements
- **Minimum VRAM**: 4 GB
- **Recommended VRAM**: 8 GB
- **Disk**: 10 GB + workspace storage

## Configuration
Default config at `~/.config/code-server/config.yaml`:
- Bind address: `0.0.0.0:8080`
- Auth: `none` (authentication handled by HAI network layer)

## Post-Deploy Usage
Access VS Code in your browser at `http://<pod-ip>:8080`

## Testing
1. Verify service: `systemctl status code-server`
2. Verify web UI: `curl -s http://localhost:8080 | head -5`
3. Check extensions: `code-server --list-extensions`
