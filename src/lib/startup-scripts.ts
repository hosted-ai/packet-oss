/**
 * Startup script presets for GPU pods
 * These scripts run automatically after pod deployment
 * Note: Scripts run as ubuntu user. Pods use dumb-init (not systemd),
 * so we start services directly with nohup instead of systemctl.
 */

/**
 * Always-on workspace setup script.
 * Prepended to EVERY startup script automatically by the instances route.
 * Detects the NFS persistent mount at /data/share* and creates /workspace
 * as a symlink to persistent storage. Copies home directory on first run.
 */
export const WORKSPACE_SETUP_SCRIPT = `
echo "=== Setting up Persistent Workspace ==="

# Detect NFS persistent mount (hosted.ai mounts shared volumes at /data/shareXX)
SHARE_PATH=$(ls -d /data/share* 2>/dev/null | head -1)

if [ -n "$SHARE_PATH" ]; then
  # Create workspace dir on persistent storage
  mkdir -p "$SHARE_PATH/workspace" 2>/dev/null || true

  # Symlink /workspace -> persistent storage (idempotent)
  if [ ! -L "/workspace" ]; then
    sudo rm -rf /workspace 2>/dev/null || true
    sudo ln -sfn "$SHARE_PATH/workspace" /workspace 2>/dev/null || ln -sfn "$SHARE_PATH/workspace" /workspace 2>/dev/null || true
  fi

  # Copy home directory on first run (preserves .bashrc, .ssh, etc.)
  if [ ! -f "$SHARE_PATH/workspace/.packet-init" ]; then
    echo "First run - copying home directory to persistent storage..."
    mkdir -p "$SHARE_PATH/workspace/home"
    cp -r $HOME/. "$SHARE_PATH/workspace/home/" 2>/dev/null || true
    touch "$SHARE_PATH/workspace/.packet-init"
  fi

  # Add /workspace/bin to PATH (idempotent)
  mkdir -p "$SHARE_PATH/workspace/bin" 2>/dev/null || true
  if ! grep -q "packet-persist" ~/.bashrc 2>/dev/null; then
    echo '# packet-persist marker' >> ~/.bashrc
    echo 'export PATH="/workspace/bin:$PATH"' >> ~/.bashrc
  fi

  echo "Workspace: /workspace -> $SHARE_PATH/workspace (persistent)"
else
  # No persistent storage — create ephemeral /workspace as fallback
  if [ ! -d "/workspace" ]; then
    sudo mkdir -p /workspace 2>/dev/null || mkdir -p /workspace 2>/dev/null || mkdir -p ~/workspace
  fi
  echo "Warning: No persistent storage detected. /workspace is ephemeral."
fi
`;

export interface PortToExpose {
  port: number;
  name: string;
}

export interface StartupScriptPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  script: string;
  estimatedMinutes: number;
  defaultPort?: number;
  portsToExpose?: PortToExpose[];
}

export const STARTUP_SCRIPT_PRESETS: StartupScriptPreset[] = [
  {
    id: "vscode",
    name: "VS Code in Browser",
    description: "code-server for browser-based development",
    icon: "💻",
    estimatedMinutes: 2,
    defaultPort: 8080,
    portsToExpose: [{ port: 8080, name: "vscode" }],
    script: `#!/bin/bash
set -e

echo "=== Installing VS Code (code-server) ==="

# Install code-server if not present
if ! command -v code-server &> /dev/null; then
    echo "Installing code-server..."
    curl -fsSL https://code-server.dev/install.sh | sh
fi

# Kill any existing code-server
pkill -f code-server 2>/dev/null || true
sleep 1

# Create log directory
mkdir -p ~/.packet-logs

# Start code-server with password auth (runs in background)
echo "Starting code-server..."
export PASSWORD=packet
nohup code-server --bind-addr 0.0.0.0:8080 --auth password > ~/.packet-logs/code-server.log 2>&1 &

# Wait for it to start
sleep 3

# Verify it's running
if pgrep -f "code-server" > /dev/null; then
    echo "=== VS Code Ready ==="
    echo "Access at: http://<your-pod-ip>:8080"
    echo "Password: packet"
else
    echo "ERROR: code-server failed to start"
    cat ~/.packet-logs/code-server.log
    exit 1
fi
`,
  },
  {
    id: "jupyter",
    name: "Jupyter Lab",
    description: "Interactive notebooks with GPU support",
    icon: "📓",
    estimatedMinutes: 3,
    defaultPort: 8888,
    portsToExpose: [{ port: 8888, name: "jupyter" }],
    script: `#!/bin/bash
set -e

echo "=== Installing Jupyter Lab ==="

# Add user local bin to PATH (pip installs scripts here)
export PATH="$HOME/.local/bin:$PATH"

# Install JupyterLab with common data science packages
pip install --quiet jupyterlab numpy pandas matplotlib seaborn scikit-learn

# Kill any existing jupyter
pkill -f jupyter 2>/dev/null || true
sleep 1

# Create workspace and log directories
mkdir -p ~/.packet-logs

# Start Jupyter Lab (runs in background)
WORKDIR="/workspace"
[ -d "/workspace" ] || WORKDIR="$HOME/workspace"

echo "Starting Jupyter Lab..."
nohup $HOME/.local/bin/jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='packet' --NotebookApp.password='' --notebook-dir="$WORKDIR" > ~/.packet-logs/jupyter.log 2>&1 &

# Wait for it to start
sleep 5

# Verify it's running
if pgrep -f "jupyter-lab" > /dev/null || pgrep -f "jupyter lab" > /dev/null; then
    echo "=== Jupyter Lab Ready ==="
    echo "Access at: http://<your-pod-ip>:8888"
    echo "Token: packet"
else
    echo "ERROR: Jupyter Lab failed to start"
    cat ~/.packet-logs/jupyter.log
    exit 1
fi
`,
  },
  {
    id: "jupyter-torch",
    name: "Jupyter + PyTorch",
    description: "Jupyter Lab with PyTorch and CUDA",
    icon: "🔥",
    estimatedMinutes: 5,
    defaultPort: 8888,
    portsToExpose: [{ port: 8888, name: "jupyter" }],
    script: `#!/bin/bash
set -e

echo "=== Installing Jupyter Lab with PyTorch ==="

# Add user local bin to PATH (pip installs scripts here)
export PATH="$HOME/.local/bin:$PATH"

# Install PyTorch with CUDA support
pip install --quiet torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install JupyterLab and common packages
pip install --quiet jupyterlab numpy pandas matplotlib seaborn scikit-learn transformers accelerate

# Kill any existing jupyter
pkill -f jupyter 2>/dev/null || true
sleep 1

# Create workspace and log directories
mkdir -p ~/.packet-logs

# Start Jupyter Lab (runs in background)
WORKDIR="/workspace"
[ -d "/workspace" ] || WORKDIR="$HOME/workspace"

echo "Starting Jupyter Lab..."
nohup $HOME/.local/bin/jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='packet' --NotebookApp.password='' --notebook-dir="$WORKDIR" > ~/.packet-logs/jupyter.log 2>&1 &

# Wait for it to start
sleep 5

# Verify it's running
if pgrep -f "jupyter-lab" > /dev/null || pgrep -f "jupyter lab" > /dev/null; then
    echo "=== Jupyter + PyTorch Ready ==="
    echo "Access at: http://<your-pod-ip>:8888"
    echo "Token: packet"
else
    echo "ERROR: Jupyter Lab failed to start"
    cat ~/.packet-logs/jupyter.log
    exit 1
fi
`,
  },
  {
    id: "full-dev",
    name: "Full Dev Environment",
    description: "VS Code + Jupyter (workspace setup is automatic)",
    icon: "🚀",
    estimatedMinutes: 5,
    defaultPort: 8080,
    portsToExpose: [{ port: 8080, name: "vscode" }, { port: 8888, name: "jupyter" }],
    script: `#!/bin/bash
set -e

echo "=== Setting up Full Development Environment ==="

# Add user local bin to PATH (pip installs scripts here)
export PATH="$HOME/.local/bin:$PATH"

# Create directories
mkdir -p ~/.packet-logs

# 1. Install VS Code
echo "Step 1/2: Installing VS Code..."
if ! command -v code-server &> /dev/null; then
    curl -fsSL https://code-server.dev/install.sh | sh
fi

# 2. Install Jupyter
echo "Step 2/2: Installing Jupyter Lab..."
pip install --quiet jupyterlab numpy pandas matplotlib

# Kill any existing services
pkill -f code-server 2>/dev/null || true
pkill -f jupyter 2>/dev/null || true
sleep 1

# Start code-server
echo "Starting code-server..."
export PASSWORD=packet
nohup code-server --bind-addr 0.0.0.0:8080 --auth password > ~/.packet-logs/code-server.log 2>&1 &

# Start Jupyter Lab
WORKDIR="/workspace"
[ -d "/workspace" ] || WORKDIR="$HOME/workspace"

echo "Starting Jupyter Lab..."
nohup $HOME/.local/bin/jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='packet' --NotebookApp.password='' --notebook-dir="$WORKDIR" > ~/.packet-logs/jupyter.log 2>&1 &

# Wait for services to start
sleep 5

# Verify services are running
VSCODE_OK=false
JUPYTER_OK=false

if pgrep -f "code-server" > /dev/null; then
    VSCODE_OK=true
fi

if pgrep -f "jupyter-lab" > /dev/null || pgrep -f "jupyter lab" > /dev/null; then
    JUPYTER_OK=true
fi

echo ""
echo "=== Full Dev Environment Ready ==="
echo ""
if [ "$VSCODE_OK" = true ]; then
    echo "VS Code:    http://<pod-ip>:8080  (password: packet)"
else
    echo "VS Code:    FAILED TO START - check ~/.packet-logs/code-server.log"
fi

if [ "$JUPYTER_OK" = true ]; then
    echo "Jupyter:    http://<pod-ip>:8888  (token: packet)"
else
    echo "Jupyter:    FAILED TO START - check ~/.packet-logs/jupyter.log"
fi

# Exit with error if neither started
if [ "$VSCODE_OK" = false ] && [ "$JUPYTER_OK" = false ]; then
    exit 1
fi
`,
  },
];

export function getStartupScriptPreset(id: string): StartupScriptPreset | undefined {
  return STARTUP_SCRIPT_PRESETS.find(p => p.id === id);
}
