# gpu-cloud-cli

Command-line interface for your GPU cloud platform.

## Installation

```bash
npm install -g gpu-cloud-cli
```

Or install from the project directory:

```bash
cd cli && npm install -g .
```

## Quick Start

```bash
# Login to your account
gpu-cloud login

# List available GPU types
gpu-cloud gpus

# Launch a GPU with VS Code pre-installed
gpu-cloud launch --gpu rtx-pro-6000 --setup vscode

# Launch a bare GPU and wait for SSH
gpu-cloud launch --gpu h100 --wait

# List your running instances
gpu-cloud ps

# SSH into an instance
gpu-cloud ssh <instance-id>

# View instance logs
gpu-cloud logs <instance-id>

# Terminate an instance
gpu-cloud terminate <instance-id>
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `gpu-cloud login` | Authenticate with your API key |
| `gpu-cloud logout` | Remove stored credentials |
| `gpu-cloud whoami` | Show current account and balance |

### GPU Management

| Command | Description |
|---------|-------------|
| `gpu-cloud gpus` | List available GPU types and pricing |
| `gpu-cloud launch --gpu <type>` | Launch a new GPU instance |
| `gpu-cloud ps` | List your running instances |
| `gpu-cloud ssh <id>` | SSH into an instance |
| `gpu-cloud logs <id>` | View instance status and info |
| `gpu-cloud terminate <id>` | Terminate an instance |

### Auto-Setup

| Command | Description |
|---------|-------------|
| `gpu-cloud setup list` | List available setup presets |
| `gpu-cloud setup <preset> <id>` | Run a setup preset on an existing instance |
| `gpu-cloud launch --setup <preset>` | Launch with auto-setup |

### `gpu-cloud launch`

Launch a new GPU instance.

Options:
- `-g, --gpu <type>` - GPU type (e.g., rtx-pro-6000, h100)
- `-n, --name <name>` - Instance name
- `-s, --setup <preset>` - Auto-setup preset (see below)
- `--gpus <count>` - Number of GPUs (default: 1)
- `-w, --wait` - Wait for instance to be ready

### `gpu-cloud setup`

Auto-setup apps on GPU instances. Available presets:

| Preset | Description | Port |
|--------|-------------|------|
| `vscode` | VS Code in Browser (code-server) | 8080 |
| `jupyter` | Jupyter Lab with data science packages | 8888 |
| `jupyter-torch` | Jupyter Lab with PyTorch and CUDA | 8888 |
| `workspace` | Persistent workspace linking | - |
| `full-dev` | VS Code + Jupyter + Persistence | 8080, 8888 |

**Launch with auto-setup:**
```bash
gpu-cloud launch --gpu rtx-pro-6000 --setup vscode
gpu-cloud launch --gpu h100 --setup full-dev --name "my-dev-box"
```

**Setup an existing instance:**
```bash
gpu-cloud setup vscode 12345
gpu-cloud setup jupyter-torch 12345
```

**List presets:**
```bash
gpu-cloud setup list
```

### `gpu-cloud ssh <instance-id>`

SSH into a running instance. Automatically uses the correct credentials.

Options:
- `-c, --command <cmd>` - Run a command instead of interactive shell
- `--copy` - Print the SSH command without connecting

### `gpu-cloud logs <instance-id>`

View instance status and connection info.

### `gpu-cloud terminate <instance-id>`

Terminate a running instance.

Options:
- `-f, --force` - Skip confirmation prompt

## Configuration

Credentials are stored securely in your system's config directory:
- macOS: `~/Library/Preferences/gpu-cloud-cli-nodejs/`
- Linux: `~/.config/gpu-cloud-cli-nodejs/`
- Windows: `%APPDATA%/gpu-cloud-cli-nodejs/`

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GPU_CLOUD_API_URL` | API URL (default: `http://localhost:3000`) |
| `GPU_CLOUD_API_KEY` | API key for non-interactive login |

## Requirements

- Node.js 18.0.0 or higher
- `sshpass` for `gpu-cloud setup` on existing instances (install with `brew install sshpass` or `apt install sshpass`)

## Examples

### Launch with VS Code pre-installed

```bash
gpu-cloud launch --gpu rtx-pro-6000 --setup vscode --name "dev-server"
```

### Launch with full dev environment

```bash
gpu-cloud launch --gpu h100 --setup full-dev
# Includes VS Code (port 8080), Jupyter (port 8888), and persistent workspace
```

### Setup Jupyter on an existing instance

```bash
# Get your instance ID
gpu-cloud ps

# Install Jupyter + PyTorch
gpu-cloud setup jupyter-torch 12345
```

### CI/CD pipeline

```bash
# In GitHub Actions or similar
gpu-cloud login --key $GPU_CLOUD_API_KEY
INSTANCE=$(gpu-cloud launch --gpu h100 --wait | grep "Instance ID" | awk '{print $3}')
gpu-cloud ssh $INSTANCE -c "cd /workspace && python train.py"
gpu-cloud terminate $INSTANCE -f
```

## License

MIT
