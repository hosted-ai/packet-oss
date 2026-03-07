# packet-gpu-cli

Command-line interface for GPU cloud platform.

## Installation

```bash
npm install -g packet-gpu-cli
```

## Quick Start

```bash
# Login to your account
packet login

# List available GPU types
packet gpus

# Launch a GPU with VS Code pre-installed
packet launch --gpu rtx-pro-6000 --setup vscode

# Launch a bare GPU and wait for SSH
packet launch --gpu h100 --wait

# List your running instances
packet ps

# SSH into an instance
packet ssh <instance-id>

# View instance logs
packet logs <instance-id>

# Terminate an instance
packet terminate <instance-id>
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `packet login` | Authenticate with your API key |
| `packet logout` | Remove stored credentials |
| `packet whoami` | Show current account and balance |

### GPU Management

| Command | Description |
|---------|-------------|
| `packet gpus` | List available GPU types and pricing |
| `packet launch --gpu <type>` | Launch a new GPU instance |
| `packet ps` | List your running instances |
| `packet ssh <id>` | SSH into an instance |
| `packet logs <id>` | View instance status and info |
| `packet terminate <id>` | Terminate an instance |

### Auto-Setup

| Command | Description |
|---------|-------------|
| `packet setup list` | List available setup presets |
| `packet setup <preset> <id>` | Run a setup preset on an existing instance |
| `packet launch --setup <preset>` | Launch with auto-setup |

### `packet launch`

Launch a new GPU instance.

Options:
- `-g, --gpu <type>` - GPU type (e.g., rtx-pro-6000, h100)
- `-n, --name <name>` - Instance name
- `-s, --setup <preset>` - Auto-setup preset (see below)
- `--gpus <count>` - Number of GPUs (default: 1)
- `-w, --wait` - Wait for instance to be ready

### `packet setup`

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
packet launch --gpu rtx-pro-6000 --setup vscode
packet launch --gpu h100 --setup full-dev --name "my-dev-box"
```

**Setup an existing instance:**
```bash
packet setup vscode 12345
packet setup jupyter-torch 12345
```

**List presets:**
```bash
packet setup list
```

### `packet ssh <instance-id>`

SSH into a running instance. Automatically uses the correct credentials.

Options:
- `-c, --command <cmd>` - Run a command instead of interactive shell
- `--copy` - Print the SSH command without connecting

### `packet logs <instance-id>`

View instance status and connection info.

### `packet terminate <instance-id>`

Terminate a running instance.

Options:
- `-f, --force` - Skip confirmation prompt

## Configuration

Credentials are stored securely in your system's config directory:
- macOS: `~/Library/Preferences/packet-cli-nodejs/`
- Linux: `~/.config/packet-cli-nodejs/`
- Windows: `%APPDATA%/packet-cli-nodejs/`

## Requirements

- Node.js 18.0.0 or higher
- An account on the GPU cloud platform
- `sshpass` for `packet setup` on existing instances (install with `brew install sshpass` or `apt install sshpass`)

## Examples

### Launch with VS Code pre-installed

```bash
packet launch --gpu rtx-pro-6000 --setup vscode --name "dev-server"
```

### Launch with full dev environment

```bash
packet launch --gpu h100 --setup full-dev
# Includes VS Code (port 8080), Jupyter (port 8888), and persistent workspace
```

### Setup Jupyter on an existing instance

```bash
# Get your instance ID
packet ps

# Install Jupyter + PyTorch
packet setup jupyter-torch 12345
```

### CI/CD pipeline

```bash
# In GitHub Actions or similar
packet login --key $PACKET_API_KEY
INSTANCE=$(packet launch --gpu h100 --wait | grep "Instance ID" | awk '{print $3}')
packet ssh $INSTANCE -c "cd /workspace && python train.py"
packet terminate $INSTANCE -f
```

## Support

- Website: [example.com](https://example.com)
- Documentation: [example.com/cli](https://example.com/cli)
- Email: support@example.com

## License

MIT
