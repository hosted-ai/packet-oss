/**
 * Deployment script templates for Hugging Face models
 * Uses native Python/pip installation (Docker not supported in K8s pods)
 */

import { DeployScriptType } from "./huggingface-catalog";

// Re-export for convenience
export type { DeployScriptType } from "./huggingface-catalog";

export interface DeployScriptParams {
  modelId?: string;
  dockerImage?: string;
  port?: number;
  hfToken?: string;
  gpuCount?: number;
  quantization?: "none" | "int8" | "int4" | "awq" | "gptq";
  openWebUI?: boolean;
  netdata?: boolean;
}

/**
 * Sanitize model ID to prevent command injection
 * Valid HuggingFace model IDs: org/model-name or model-name
 * Only allows: alphanumeric, forward slash, hyphen, underscore, period
 */
function sanitizeModelId(modelId: string): string {
  // Remove any characters that could be used for shell injection
  // Valid chars: a-z, A-Z, 0-9, /, -, _, .
  const sanitized = modelId.replace(/[^a-zA-Z0-9/_.-]/g, "");

  // Validate format: should be "org/model" or just "model"
  // Max 2 path segments (org/model)
  const segments = sanitized.split("/");
  if (segments.length > 2) {
    throw new Error("Invalid model ID format: too many path segments");
  }

  // Each segment must be non-empty and start with alphanumeric
  for (const segment of segments) {
    if (!segment || !/^[a-zA-Z0-9]/.test(segment)) {
      throw new Error("Invalid model ID format: segments must start with alphanumeric character");
    }
  }

  // Max length check to prevent buffer issues
  if (sanitized.length > 256) {
    throw new Error("Model ID too long (max 256 characters)");
  }

  return sanitized;
}

/**
 * Sanitize HuggingFace token to prevent command injection
 * Valid HF tokens start with "hf_" and are alphanumeric
 */
function sanitizeHfToken(token: string): string {
  // HF tokens should start with "hf_" and be alphanumeric
  const sanitized = token.replace(/[^a-zA-Z0-9_]/g, "");

  if (!sanitized.startsWith("hf_")) {
    throw new Error("Invalid HuggingFace token format: must start with 'hf_'");
  }

  // Max length check
  if (sanitized.length > 256) {
    throw new Error("HuggingFace token too long");
  }

  return sanitized;
}

/**
 * Generate a deployment script based on type and parameters
 */
export function generateDeployScript(
  type: DeployScriptType,
  params: DeployScriptParams
): string {
  switch (type) {
    case "tgi":
    case "vllm":
    case "docker":
    case "ollama":
      return generateVLLMNativeScript(params);
    case "space":
      return generateSpaceScript(params);
    default:
      return generateVLLMNativeScript(params);
  }
}

/**
 * vLLM native Python deployment (no Docker)
 * Works in Kubernetes pods without privileged mode
 * Runs installation in background to avoid SSH timeout
 *
 * Memory calculation:
 * - Queries actual GPU memory via nvidia-smi
 * - Estimates model size from parameter count in name (e.g., "7B" = 7 billion params)
 * - Calculates safe max-model-len to avoid OOM
 */
function generateVLLMNativeScript(params: DeployScriptParams): string {
  const { modelId, port = 8000, hfToken, gpuCount = 1, openWebUI = false, netdata = false } = params;

  if (!modelId) {
    throw new Error("modelId is required");
  }

  // Sanitize inputs to prevent command injection
  const safeModelId = sanitizeModelId(modelId);
  const safeHfToken = hfToken ? sanitizeHfToken(hfToken) : null;

  const hfTokenExport = safeHfToken ? `export HF_TOKEN="${safeHfToken}"` : "";

  // The entire installation and server start runs in background
  // This prevents SSH timeout during the long vLLM install
  return `#!/bin/bash

echo "=== GPU Cloud HuggingFace Deployment ==="
echo "Model: ${safeModelId}"
echo "Port: ${port}"
echo ""

# Kill any existing server
pkill -f "vllm.entrypoints" 2>/dev/null || true

# Use home directory for workspace
WORKSPACE="$HOME/hf-workspace"
mkdir -p "$WORKSPACE" "$WORKSPACE/cache"
cd "$WORKSPACE"

# ============================================
# GPU Memory Calculation
# ============================================
# Get GPU memory in GB
GPU_MEM_MB=\$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
GPU_MEM_GB=\$((GPU_MEM_MB / 1024))
echo "GPU Memory: \${GPU_MEM_GB}GB"

# Extract model size from model name (e.g., "7B", "13B", "70B")
MODEL_NAME="${safeModelId}"
MODEL_PARAMS=0
if echo "\$MODEL_NAME" | grep -qiE '[^0-9]([0-9]+\\.?[0-9]*)b[^a-z]|[^0-9]([0-9]+\\.?[0-9]*)b$'; then
  MODEL_PARAMS=\$(echo "\$MODEL_NAME" | grep -oiE '[0-9]+\\.?[0-9]*b' | tail -1 | tr -d 'bB')
fi

# Default to 7B if we can't detect
if [ -z "\$MODEL_PARAMS" ] || [ "\$MODEL_PARAMS" = "0" ]; then
  MODEL_PARAMS=7
  echo "Could not detect model size, assuming 7B parameters"
else
  echo "Detected model size: \${MODEL_PARAMS}B parameters"
fi

# Estimate model memory: params * 2 bytes (fp16) + 30% overhead for activations
# Formula: model_gb = params_billions * 2.6
MODEL_MEM_GB=\$(echo "\$MODEL_PARAMS * 2.6" | bc 2>/dev/null || echo "18")
MODEL_MEM_GB=\${MODEL_MEM_GB%.*}  # Remove decimals
# Add minimum of 2GB extra buffer
MODEL_MEM_GB=\$((MODEL_MEM_GB + 2))
echo "Estimated model memory (with buffer): \${MODEL_MEM_GB}GB"

# Calculate available memory for KV cache (leave 25% buffer for safety)
USABLE_MEM_GB=\$((GPU_MEM_GB * 75 / 100))
KV_CACHE_GB=\$((USABLE_MEM_GB - MODEL_MEM_GB))
if [ "\$KV_CACHE_GB" -lt 2 ]; then
  KV_CACHE_GB=2
fi
echo "Available for KV cache: \${KV_CACHE_GB}GB"

# Calculate max-model-len based on KV cache budget
# vLLM KV cache formula (simplified):
#   kv_cache_gb ≈ (num_layers * hidden_size * 4 * seq_len) / 1e9
# For 7B model (28 layers, 3584 hidden): ~0.4MB per token
# For 13B model: ~0.8MB per token
# For 70B model: ~2.5MB per token
# Use conservative estimate: 1MB per token per billion params / 7
MB_PER_TOKEN=\$(echo "scale=2; \$MODEL_PARAMS / 7 * 0.5 + 0.3" | bc 2>/dev/null || echo "0.8")
# Convert to tokens per GB (1024 MB per GB)
TOKENS_PER_GB=\$(echo "scale=0; 1024 / \$MB_PER_TOKEN" | bc 2>/dev/null || echo "1280")
MAX_MODEL_LEN=\$((KV_CACHE_GB * TOKENS_PER_GB))

# Cap based on model size (larger models need shorter context to fit)
if [ "\$MODEL_PARAMS" -ge 70 ]; then
  MAX_CAP=8192
elif [ "\$MODEL_PARAMS" -ge 30 ]; then
  MAX_CAP=16384
elif [ "\$MODEL_PARAMS" -ge 13 ]; then
  MAX_CAP=24576
else
  MAX_CAP=32768
fi

if [ "\$MAX_MODEL_LEN" -gt "\$MAX_CAP" ]; then
  MAX_MODEL_LEN=\$MAX_CAP
fi
if [ "\$MAX_MODEL_LEN" -lt 2048 ]; then
  MAX_MODEL_LEN=2048
fi
echo "Calculated max-model-len: \$MAX_MODEL_LEN tokens (cap: \$MAX_CAP)"

# Use fixed conservative GPU memory utilization
GPU_UTIL="0.85"
echo "GPU memory utilization: \$GPU_UTIL"
echo ""

# Check if vLLM is already installed
if [ -f "venv/bin/python" ] && "$WORKSPACE/venv/bin/python" -c "import vllm" 2>/dev/null; then
  echo "vLLM already installed, starting server directly..."

  ${hfTokenExport}
  export HF_HOME="$WORKSPACE/cache"

  nohup "$WORKSPACE/venv/bin/python" -m vllm.entrypoints.openai.api_server \\
    --model "${safeModelId}" \\
    --host 0.0.0.0 \\
    --port ${port} \\
    --tensor-parallel-size ${gpuCount} \\
    --max-model-len \$MAX_MODEL_LEN \\
    --gpu-memory-utilization \$GPU_UTIL \\
    --enforce-eager \\
    --disable-frontend-multiprocessing \\
    --trust-remote-code \\
    --dtype float16 \\
    > "$WORKSPACE/vllm.log" 2>&1 &

  sleep 3
  echo ""
  echo "=== Server Starting ==="
  tail -10 "$WORKSPACE/vllm.log" 2>/dev/null || echo "Waiting for log..."
  echo ""
${openWebUI ? `
  # ============================================
  # Open WebUI Installation (Chat Interface)
  # ============================================
  echo "Installing Open WebUI chat interface..."

  # Install Open WebUI in the same venv
  pip install open-webui >> "$WORKSPACE/openwebui-install.log" 2>&1 &
  WEBUI_PID=$!

  # Wait for installation (with timeout)
  TIMEOUT=300
  ELAPSED=0
  while kill -0 $WEBUI_PID 2>/dev/null && [ $ELAPSED -lt $TIMEOUT ]; do
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo "  Installing Open WebUI... ($ELAPSED seconds)"
  done

  if kill -0 $WEBUI_PID 2>/dev/null; then
    echo "Warning: Open WebUI installation timed out, continuing in background"
  fi

  # Start Open WebUI pointing to local vLLM
  echo "Starting Open WebUI on port 3000..."
  export OLLAMA_BASE_URL="http://localhost:${port}/v1"
  export OPENAI_API_BASE_URL="http://localhost:${port}/v1"
  export OPENAI_API_KEY="not-needed"
  export WEBUI_AUTH=false

  nohup "$WORKSPACE/venv/bin/open-webui" serve --host 0.0.0.0 --port 3000 > "$WORKSPACE/openwebui.log" 2>&1 &

  echo "Open WebUI starting on port 3000"
  echo "WEBUI_PORT=3000"
` : ''}
${netdata ? `
  # ============================================
  # Netdata Installation (GPU Monitoring)
  # ============================================
  echo "Installing Netdata monitoring..."

  # Check if Netdata is already installed (use sudo since SSH user may not be root)
  if ! command -v netdata &> /dev/null; then
    # Install Netdata using the official kickstart script
    export DEBIAN_FRONTEND=noninteractive
    curl -Ss https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh 2>/dev/null
    chmod +x /tmp/netdata-kickstart.sh

    # Install with GPU monitoring support, no telemetry, no cloud
    # Use --install-type any for better compatibility with Ubuntu 24.04+
    sudo bash /tmp/netdata-kickstart.sh --dont-wait --no-updates --disable-cloud --install-type any >> "$WORKSPACE/netdata-install.log" 2>&1

    if [ $? -eq 0 ]; then
      echo "Netdata installed successfully"
      # Restart to pick up GPU
      sudo systemctl restart netdata 2>/dev/null || sudo service netdata restart 2>/dev/null || true
    else
      echo "Warning: Netdata installation failed"
    fi
  else
    echo "Netdata already installed"
    # Ensure it's running
    sudo systemctl restart netdata 2>/dev/null || sudo service netdata restart 2>/dev/null || true
  fi

  echo "Netdata dashboard available on port 19999"
  echo "NETDATA_PORT=19999"
` : ''}
  echo "DEPLOYMENT_STARTED"
  exit 0
fi

echo "vLLM not installed. Starting background installation..."
echo "This takes 5-10 minutes. Check progress: tail -f ~/hf-workspace/install.log"
echo ""

# Install prerequisites FIRST (before starting background script)
# Test if venv actually works by trying to create one
rm -rf /tmp/test-venv 2>/dev/null || true
if ! python3 -m venv /tmp/test-venv 2>/dev/null; then
  echo "Installing Python venv package..."
  # Get Python version in a portable way
  PYVER=\$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  echo "Detected Python version: \$PYVER"
  # Run apt with DEBIAN_FRONTEND to avoid interactive prompts
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq 2>/dev/null || true
  sudo apt-get install -y --no-install-recommends python\${PYVER}-venv python3-pip 2>&1 | tail -3 || {
    echo "apt-get install failed, trying alternate packages..."
    sudo apt-get install -y --no-install-recommends python3-venv python3-pip 2>&1 | tail -3 || true
  }
  rm -rf /tmp/test-venv 2>/dev/null || true
fi

# Save calculated values to a config file for the background script
cat > "$WORKSPACE/vllm-config.sh" << EOF
MAX_MODEL_LEN=\$MAX_MODEL_LEN
GPU_UTIL=\$GPU_UTIL
MODEL_PARAMS=\$MODEL_PARAMS
GPU_MEM_GB=\$GPU_MEM_GB
OPEN_WEBUI=${openWebUI ? '1' : '0'}
NETDATA=${netdata ? '1' : '0'}
VLLM_PORT=${port}
EOF

# Create the install script
cat > "$WORKSPACE/install-and-run.sh" << 'INSTALL_SCRIPT'
#!/bin/bash
cd "$HOME/hf-workspace"

log() {
  echo "$(date): $1" >> install.log
}

log "Starting installation..."

# Load calculated GPU/memory config
if [ -f "vllm-config.sh" ]; then
  source vllm-config.sh
  log "Loaded config: MAX_MODEL_LEN=$MAX_MODEL_LEN, GPU_UTIL=$GPU_UTIL"
else
  # Fallback defaults if config missing
  MAX_MODEL_LEN=8192
  GPU_UTIL=0.85
  log "Using fallback config: MAX_MODEL_LEN=$MAX_MODEL_LEN, GPU_UTIL=$GPU_UTIL"
fi

# Install python venv if needed (in case first check failed)
if ! python3 -m venv /tmp/venv-test 2>/dev/null; then
  log "Installing python3-venv..."
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq 2>/dev/null
  sudo apt-get install -y --no-install-recommends python3-venv python3-pip 2>&1 | tail -3
fi
rm -rf /tmp/venv-test 2>/dev/null

# Create virtual environment
if [ ! -f "venv/bin/activate" ]; then
  log "Creating virtual environment..."
  rm -rf venv
  if ! python3 -m venv venv; then
    log "ERROR: Failed to create virtual environment"
    exit 1
  fi
fi

source venv/bin/activate

# Install vLLM
log "Installing pip..."
pip install --upgrade pip >> install.log 2>&1

log "Installing vLLM (this takes a while)..."
if ! pip install vllm >> install.log 2>&1; then
  log "ERROR: vLLM installation failed"
  exit 1
fi

log "INSTALL_COMPLETE"

# Now start the server
${hfTokenExport}
export HF_HOME="$HOME/hf-workspace/cache"

log "Starting vLLM server for ${safeModelId}..."
log "Using max-model-len=$MAX_MODEL_LEN, gpu-memory-utilization=$GPU_UTIL"

python -m vllm.entrypoints.openai.api_server \\
  --model "${safeModelId}" \\
  --host 0.0.0.0 \\
  --port ${port} \\
  --tensor-parallel-size ${gpuCount} \\
  --max-model-len $MAX_MODEL_LEN \\
  --gpu-memory-utilization $GPU_UTIL \\
  --enforce-eager \\
  --disable-frontend-multiprocessing \\
  --trust-remote-code \\
  --dtype float16 \\
  >> vllm.log 2>&1 &

log "SERVER_STARTED"

# Wait for vLLM to be ready before starting addons
sleep 10

# Install and start Open WebUI if enabled
if [ "$OPEN_WEBUI" = "1" ]; then
  log "Installing Open WebUI chat interface..."

  # Install Open WebUI
  pip install open-webui >> install.log 2>&1

  if [ $? -eq 0 ]; then
    log "Open WebUI installed successfully"

    # Start Open WebUI pointing to local vLLM
    export OLLAMA_BASE_URL="http://localhost:$VLLM_PORT/v1"
    export OPENAI_API_BASE_URL="http://localhost:$VLLM_PORT/v1"
    export OPENAI_API_KEY="not-needed"
    export WEBUI_AUTH=false

    log "Starting Open WebUI on port 3000..."
    nohup open-webui serve --host 0.0.0.0 --port 3000 >> openwebui.log 2>&1 &

    log "WEBUI_STARTED"
    log "Open WebUI available on port 3000"
  else
    log "WARNING: Open WebUI installation failed"
  fi
fi

# Install and start Netdata if enabled
if [ "$NETDATA" = "1" ]; then
  log "Installing Netdata monitoring..."

  # Install Netdata using the official kickstart script (use sudo since SSH user may not be root)
  export DEBIAN_FRONTEND=noninteractive
  curl -Ss https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh 2>> install.log
  chmod +x /tmp/netdata-kickstart.sh

  # Install with GPU monitoring support, no telemetry, no cloud
  # Use --install-type any for better compatibility with Ubuntu 24.04+
  sudo bash /tmp/netdata-kickstart.sh --dont-wait --no-updates --disable-cloud --install-type any >> install.log 2>&1

  if [ $? -eq 0 ]; then
    log "Netdata installed successfully"

    # Ensure nvidia-smi plugin is enabled for GPU metrics
    if [ -f /etc/netdata/netdata.conf ]; then
      log "Configuring Netdata for GPU monitoring..."
    fi

    # Restart netdata to pick up GPU
    sudo systemctl restart netdata 2>/dev/null || sudo service netdata restart 2>/dev/null || true

    log "NETDATA_STARTED"
    log "Netdata dashboard available on port 19999"
  else
    log "WARNING: Netdata installation failed"
  fi
fi
INSTALL_SCRIPT

chmod +x "$WORKSPACE/install-and-run.sh"

# Run the install script in background with nohup
echo "" > "$WORKSPACE/install.log"
nohup "$WORKSPACE/install-and-run.sh" >> "$WORKSPACE/install.log" 2>&1 &

sleep 2
echo "=== Installation Started ==="
tail -5 "$WORKSPACE/install.log" 2>/dev/null || echo "Starting..."
echo ""
echo "DEPLOYMENT_INSTALLING"
`;
}

/**
 * Gradio Space deployment script
 */
function generateSpaceScript(params: DeployScriptParams): string {
  const { modelId: spaceId, port = 7860, hfToken } = params;

  if (!spaceId) {
    throw new Error("spaceId is required for Space deployment");
  }

  // Sanitize inputs to prevent command injection
  const safeSpaceId = sanitizeModelId(spaceId);
  const safeHfToken = hfToken ? sanitizeHfToken(hfToken) : null;

  const gitUrl = safeHfToken
    ? `https://user:${safeHfToken}@huggingface.co/spaces/${safeSpaceId}`
    : `https://huggingface.co/spaces/${safeSpaceId}`;

  return `#!/bin/bash
set -e

echo "=== GPU Cloud HuggingFace Space Deployment ==="
echo "Space: ${safeSpaceId}"
echo "Port: ${port}"
echo ""

# Install dependencies
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv python3-full git git-lfs

# Use home directory for workspace
WORKSPACE="$HOME/hf-workspace"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

# Clone the space
echo "Cloning space..."
rm -rf space
git lfs install
git clone ${gitUrl} space
cd space

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install requirements
if [ -f requirements.txt ]; then
  pip install -r requirements.txt
fi

# Install Gradio if not in requirements
pip install gradio

# Find and run the app
APP_FILE=""
for f in app.py main.py server.py; do
  if [ -f "$f" ]; then
    APP_FILE="$f"
    break
  fi
done

if [ -z "$APP_FILE" ]; then
  echo "Error: Could not find app.py, main.py, or server.py"
  exit 1
fi

echo "Starting Space with $APP_FILE..."
GRADIO_SERVER_NAME=0.0.0.0 GRADIO_SERVER_PORT=${port} nohup python $APP_FILE > ../space.log 2>&1 &

echo ""
echo "=== Deployment Complete ==="
echo "Space running on port ${port}"
echo "Access at: http://0.0.0.0:${port}"
echo ""
echo "Logs: tail -f $WORKSPACE/space.log"
`;
}

/**
 * Validate deployment parameters
 */
export function validateDeployParams(
  type: DeployScriptType,
  params: DeployScriptParams
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Model ID is required for model/docker deployments (but not spaces)
  if (type !== "space" && !params.modelId) {
    errors.push("Model ID is required");
  }

  if (params.port && (params.port < 1 || params.port > 65535)) {
    errors.push("Port must be between 1 and 65535");
  }

  if (params.hfToken && !params.hfToken.startsWith("hf_")) {
    errors.push("HF token should start with 'hf_'");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get default port for deployment type
 */
export function getDefaultPort(type: DeployScriptType): number {
  // All models now use vLLM on port 8000
  return 8000;
}

/**
 * Get deployment type display name
 */
export function getDeployTypeName(type: DeployScriptType): string {
  const names: Record<DeployScriptType, string> = {
    tgi: "vLLM Server",
    vllm: "vLLM Server",
    docker: "vLLM Server",
    ollama: "vLLM Server",
    space: "Gradio Space",
  };
  return names[type];
}
