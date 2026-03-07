/**
 * GPU Apps - Development Category
 *
 * Development environment apps: Jupyter, VS Code, Langflow, MLflow
 *
 * @module lib/gpu-apps/apps/development
 */

import { type GpuAppDefinition, SCRIPT_PREAMBLE } from "./types";

export const DEVELOPMENT_APPS: GpuAppDefinition[] = [
  {
    slug: "jupyter-pytorch",
    name: "Jupyter + PyTorch",
    description: "Full Python development environment with PyTorch, CUDA, and JupyterLab",
    longDescription: `Complete GPU-accelerated development environment:
• JupyterLab with extensions for code completion and debugging
• PyTorch 2.x with CUDA support
• Common ML libraries: transformers, datasets, accelerate
• Visualization: matplotlib, plotly, tensorboard
• Data processing: pandas, numpy, scipy`,
    category: "development",
    minVramGb: 4,
    recommendedVramGb: 16,
    typicalVramUsageGb: 2,
    estimatedInstallMin: 5,
    defaultPort: 8888,
    serviceType: "http",
    icon: "🐍",
    badgeText: "Popular",
    displayOrder: 1,
    tags: ["python", "pytorch", "jupyter", "development"],
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Jupyter + PyTorch ==="

# Update package list
sudo apt-get update -qq

# Install Python and pip if not present
sudo apt-get install -y python3-pip python3-venv > /dev/null 2>&1

# Create virtual environment
sudo mkdir -p /opt/jupyter-env
sudo chown ubuntu:ubuntu /opt/jupyter-env
create_venv /opt/jupyter-env
source /opt/jupyter-env/bin/activate

# Install PyTorch with CUDA
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install JupyterLab and common packages
pip install --quiet jupyterlab numpy pandas matplotlib plotly scipy scikit-learn
pip install --quiet transformers datasets accelerate tensorboard
pip install --quiet ipywidgets jupyterlab-git

# Generate Jupyter config
mkdir -p ~/.jupyter
cat > ~/.jupyter/jupyter_lab_config.py << 'JUPYTERCONFIG'
c.ServerApp.ip = '0.0.0.0'
c.ServerApp.port = 8888
c.ServerApp.open_browser = False
c.ServerApp.allow_root = True
c.ServerApp.token = ''
c.ServerApp.password = ''
c.ServerApp.allow_origin = '*'
JUPYTERCONFIG

# Create startup script
sudo tee /opt/start-jupyter.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
source /opt/jupyter-env/bin/activate
cd /home/ubuntu
exec jupyter lab
STARTSCRIPT
sudo chmod +x /opt/start-jupyter.sh

# Start JupyterLab
nohup /opt/start-jupyter.sh > ~/jupyter.log 2>&1 &

echo "=== Jupyter + PyTorch installed ==="
echo "PORT=8888"
`,
  },

  {
    slug: "code-server",
    name: "VS Code Server",
    description: "Full VS Code IDE in your browser with GPU access",
    longDescription: `Complete development environment:
• Full VS Code experience in browser
• All extensions available
• Integrated terminal with GPU access
• Git integration
• Python, Jupyter, and AI extensions pre-configured`,
    category: "development",
    minVramGb: 4,
    recommendedVramGb: 8,
    typicalVramUsageGb: 1,
    estimatedInstallMin: 3,
    defaultPort: 8080,
    serviceType: "http",
    icon: "📝",
    displayOrder: 9,
    tags: ["vscode", "ide", "development", "code"],
    docsUrl: "https://github.com/coder/code-server",
    installScript: `#!/bin/bash
set -e

echo "=== Installing VS Code Server ==="

# Install code-server
curl -fsSL https://code-server.dev/install.sh | sudo sh

# Configure code-server for ubuntu user
mkdir -p ~/.config/code-server
cat > ~/.config/code-server/config.yaml << 'CONFIG'
bind-addr: 0.0.0.0:8080
auth: none
cert: false
CONFIG

# Create startup script (nohup method for container environments)
sudo tee /opt/start-code-server.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
exec /usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth none
STARTSCRIPT
sudo chmod +x /opt/start-code-server.sh

# Start code-server in background
nohup /opt/start-code-server.sh > ~/code-server.log 2>&1 &

# Wait for code-server to start
sleep 5

# Install useful extensions
code-server --install-extension ms-python.python 2>/dev/null || true
code-server --install-extension ms-toolsai.jupyter 2>/dev/null || true

echo "=== VS Code Server installed ==="
echo "PORT=8080"
`,
  },

  {
    slug: "langflow",
    name: "Langflow",
    description: "Visual framework for building LLM applications",
    longDescription: `No-code LLM app builder:
• Drag-and-drop interface
• LangChain components visual
• Build RAG pipelines easily
• API endpoint generation
• Chat interface included
• Export to Python code`,
    category: "development",
    minVramGb: 4,
    recommendedVramGb: 8,
    typicalVramUsageGb: 2,
    estimatedInstallMin: 5,
    defaultPort: 7860,
    webUiPort: 7860,
    serviceType: "http",
    icon: "🔗",
    displayOrder: 18,
    tags: ["langchain", "no-code", "rag", "agents"],
    docsUrl: "https://github.com/langflow-ai/langflow",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Langflow ==="

sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-venv > /dev/null 2>&1

# Create virtual environment
sudo mkdir -p /opt/langflow-env
sudo chown ubuntu:ubuntu /opt/langflow-env
create_venv /opt/langflow-env
source /opt/langflow-env/bin/activate

# Install Langflow
pip install --quiet langflow

# Create startup script
sudo tee /opt/start-langflow.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
source /opt/langflow-env/bin/activate
exec langflow run --host 0.0.0.0 --port 7860
STARTSCRIPT
sudo chmod +x /opt/start-langflow.sh

nohup /opt/start-langflow.sh > ~/langflow.log 2>&1 &

# Wait for server to start
sleep 5

echo "=== Langflow installed ==="
echo "PORT=7860"
echo "INFO=Access the visual builder at http://localhost:7860"
`,
  },

  {
    slug: "mlflow",
    name: "MLflow",
    description: "ML experiment tracking and model registry",
    longDescription: `Complete MLOps platform:
• Experiment tracking
• Model versioning and registry
• Model deployment (MLflow Models)
• Project packaging
• Integration with all ML frameworks
• REST API for model serving`,
    category: "development",
    minVramGb: 4,
    recommendedVramGb: 8,
    typicalVramUsageGb: 1,
    estimatedInstallMin: 3,
    defaultPort: 5000,
    webUiPort: 5000,
    serviceType: "http",
    icon: "📊",
    displayOrder: 19,
    tags: ["mlops", "tracking", "experiments", "models"],
    docsUrl: "https://github.com/mlflow/mlflow",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing MLflow ==="

sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-venv > /dev/null 2>&1

# Create virtual environment
sudo mkdir -p /opt/mlflow-env
sudo chown ubuntu:ubuntu /opt/mlflow-env
create_venv /opt/mlflow-env
source /opt/mlflow-env/bin/activate

# Install MLflow with extras
pip install --quiet mlflow[extras]

# Install common ML frameworks for logging
pip install --quiet torch scikit-learn xgboost

# Create data directories
mkdir -p ~/mlflow-data/artifacts
mkdir -p ~/mlflow-data/db

# Create startup script
sudo tee /opt/start-mlflow.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
source /opt/mlflow-env/bin/activate
exec mlflow server \\
  --host 0.0.0.0 \\
  --port 5000 \\
  --backend-store-uri sqlite:////home/ubuntu/mlflow-data/db/mlflow.db \\
  --default-artifact-root /home/ubuntu/mlflow-data/artifacts
STARTSCRIPT
sudo chmod +x /opt/start-mlflow.sh

nohup /opt/start-mlflow.sh > ~/mlflow.log 2>&1 &

# Wait for server to start
sleep 5

echo "=== MLflow installed ==="
echo "PORT=5000"
echo "INFO=Set MLFLOW_TRACKING_URI=http://localhost:5000 in your training scripts"
`,
  },
];
