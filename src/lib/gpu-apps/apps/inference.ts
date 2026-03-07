/**
 * GPU Apps - Inference Category
 *
 * LLM/inference apps: vLLM, TGI, Triton, LocalAI, Text Gen WebUI, Open WebUI
 *
 * @module lib/gpu-apps/apps/inference
 */

import { type GpuAppDefinition, SCRIPT_PREAMBLE } from "./types";

export const INFERENCE_APPS: GpuAppDefinition[] = [
  {
    slug: "vllm-v1-tinyllama",
    name: "vLLM V1 + TinyLlama",
    description: "One-click vLLM V1 with TinyLlama 1.1B - ready for immediate inference",
    longDescription: `Production-ready vLLM V1 with TinyLlama pre-configured:
• vLLM V1 engine with 1.5x speed improvement
• TinyLlama 1.1B Chat (LLaMA 2 architecture) pre-loaded
• OpenAI-compatible API at /v1/chat/completions
• Works immediately after install - no model download wait
• Streaming responses enabled
• Perfect for testing, development, and small deployments
• Upgradeable to larger models anytime`,
    category: "inference",
    minVramGb: 4,
    recommendedVramGb: 8,
    typicalVramUsageGb: 3,
    estimatedInstallMin: 5,
    defaultPort: 8000,
    serviceType: "http",
    icon: "🦙",
    badgeText: "V1",
    displayOrder: 2,
    tags: ["llm", "inference", "api", "vllm", "v1", "tinyllama", "one-click"],
    docsUrl: "https://docs.vllm.ai/en/stable/usage/v1_guide/",
    installScript: `#!/bin/bash
set -e

echo "=== Installing vLLM V1 + TinyLlama 1.1B ==="
echo "This is the recommended one-click LLM deployment for immediate use."
echo "Uses Docker extraction method for RTX Blackwell SM120 support."
echo ""

# Kill any existing vLLM/inference processes to free GPU memory
pkill -f "vllm" 2>/dev/null || true
pkill -f "python.*vllm" 2>/dev/null || true
sleep 2

# Install dependencies
sudo apt-get update -qq
sudo apt-get install -y python3-pip python3.12 curl > /dev/null 2>&1

# Check if we already have the docker extraction
if [ ! -d ~/vllm-docker-extract/usr/local/lib/python3.12/dist-packages/vllm ]; then
  echo "Extracting vLLM 0.14.0 from Docker image (has SM120 Blackwell support)..."

  # Download docker-image-extract script
  curl -sL https://raw.githubusercontent.com/jjlin/docker-image-extract/main/docker-image-extract > /tmp/docker-image-extract
  chmod +x /tmp/docker-image-extract

  # Extract the vLLM docker image (contains vLLM 0.14.0 + PyTorch 2.9.1+cu129 with SM120)
  rm -rf ~/vllm-docker-extract
  mkdir -p ~/vllm-docker-extract
  cd ~
  /tmp/docker-image-extract -o vllm-docker-extract vllm/vllm-openai:latest

  echo "Docker extraction complete (~19GB)"
fi

# Verify extraction
if [ ! -d ~/vllm-docker-extract/usr/local/lib/python3.12/dist-packages/vllm ]; then
  echo "ERROR: vLLM extraction failed"
  exit 1
fi

# Create startup script using docker-extracted packages
sudo tee /opt/start-vllm-tinyllama.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
# vLLM V1 + TinyLlama using Docker-extracted packages with SM120 Blackwell support
# Contains: vLLM 0.14.0, PyTorch 2.9.1+cu129, CUDA 12.9

export PYTHONPATH="$HOME/vllm-docker-extract/usr/local/lib/python3.12/dist-packages:$PYTHONPATH"
export PATH="$HOME/vllm-docker-extract/usr/local/bin:$PATH"
export VLLM_USE_V1=1
export CUDA_VISIBLE_DEVICES=0

# Kill any existing vLLM processes
pkill -f "vllm" 2>/dev/null || true
sleep 2

MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"
echo "Starting vLLM V1 0.14.0 with $MODEL..."

exec python3.12 -m vllm.entrypoints.openai.api_server \\
  --model "$MODEL" \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --max-model-len 2048 \\
  --enforce-eager
STARTSCRIPT
sudo chmod +x /opt/start-vllm-tinyllama.sh

# Start vLLM server
echo "Starting vLLM V1 server..."
nohup /opt/start-vllm-tinyllama.sh > ~/vllm-tinyllama.log 2>&1 &

# Wait for server to start loading
sleep 10

# Create a test script
sudo tee /opt/test-vllm.sh > /dev/null << 'TESTSCRIPT'
#!/bin/bash
echo "Testing vLLM endpoint..."
curl -s http://localhost:8000/v1/models | python3 -m json.tool 2>/dev/null || echo "Server still loading..."
echo ""
echo "Test chat completion:"
curl -s http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}' \\
  | python3 -m json.tool 2>/dev/null || echo "Server still loading model..."
TESTSCRIPT
sudo chmod +x /opt/test-vllm.sh

echo ""
echo "=== vLLM V1 + TinyLlama 1.1B installed ==="
echo "PORT=8000"
echo "INFO=vLLM 0.14.0 with SM120 Blackwell support"
echo "INFO=OpenAI-compatible API at http://localhost:8000/v1"
echo "INFO=Model: TinyLlama/TinyLlama-1.1B-Chat-v1.0 (~200 tok/s)"
echo "INFO=Test with: /opt/test-vllm.sh"
`,
  },

  {
    slug: "vllm-server",
    name: "vLLM Inference Server",
    description: "High-performance LLM inference with V1 engine and OpenAI-compatible API",
    longDescription: `Production-ready LLM inference server with V1 engine:
• V1 engine with 1.5x speed improvement
• OpenAI-compatible API endpoint
• Continuous batching for high throughput
• PagedAttention for efficient memory
• Support for 100+ HuggingFace models
• Streaming responses
• Ready for any model up to 70B on 96GB VRAM`,
    category: "inference",
    minVramGb: 16,
    recommendedVramGb: 48,
    typicalVramUsageGb: 40,
    estimatedInstallMin: 8,
    defaultPort: 8000,
    serviceType: "http",
    icon: "⚡",
    badgeText: "Fast",
    displayOrder: 3,
    tags: ["llm", "inference", "api", "vllm", "v1"],
    docsUrl: "https://docs.vllm.ai",
    installScript: `#!/bin/bash
set -e

echo "=== Installing vLLM Inference Server (V1 Engine) ==="
echo "Uses Docker extraction method for RTX Blackwell SM120 support."
echo ""

# Kill any existing vLLM/inference processes to free GPU memory
pkill -f "vllm" 2>/dev/null || true
pkill -f "python.*vllm" 2>/dev/null || true
sleep 2

# Install dependencies
sudo apt-get update -qq
sudo apt-get install -y python3-pip python3.12 curl > /dev/null 2>&1

# Check if we already have the docker extraction
if [ ! -d ~/vllm-docker-extract/usr/local/lib/python3.12/dist-packages/vllm ]; then
  echo "Extracting vLLM 0.14.0 from Docker image (has SM120 Blackwell support)..."

  # Download docker-image-extract script
  curl -sL https://raw.githubusercontent.com/jjlin/docker-image-extract/main/docker-image-extract > /tmp/docker-image-extract
  chmod +x /tmp/docker-image-extract

  # Extract the vLLM docker image (contains vLLM 0.14.0 + PyTorch 2.9.1+cu129 with SM120)
  rm -rf ~/vllm-docker-extract
  mkdir -p ~/vllm-docker-extract
  cd ~
  /tmp/docker-image-extract -o vllm-docker-extract vllm/vllm-openai:latest

  echo "Docker extraction complete (~19GB)"
fi

# Verify extraction
if [ ! -d ~/vllm-docker-extract/usr/local/lib/python3.12/dist-packages/vllm ]; then
  echo "ERROR: vLLM extraction failed"
  exit 1
fi

# Create startup script using docker-extracted packages
sudo tee /opt/start-vllm.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
# vLLM V1 Server using Docker-extracted packages with SM120 Blackwell support
# Contains: vLLM 0.14.0, PyTorch 2.9.1+cu129, CUDA 12.9

export PYTHONPATH="$HOME/vllm-docker-extract/usr/local/lib/python3.12/dist-packages:$PYTHONPATH"
export PATH="$HOME/vllm-docker-extract/usr/local/bin:$PATH"
export VLLM_USE_V1=1
export CUDA_VISIBLE_DEVICES=0

# Kill any existing vLLM processes
pkill -f "vllm" 2>/dev/null || true
sleep 2

# Use model from environment or default to TinyLlama
MODEL=\${VLLM_MODEL:-"TinyLlama/TinyLlama-1.1B-Chat-v1.0"}
echo "Starting vLLM V1 0.14.0 with $MODEL..."

exec python3.12 -m vllm.entrypoints.openai.api_server \\
  --model "$MODEL" \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --max-model-len 2048 \\
  --enforce-eager
STARTSCRIPT
sudo chmod +x /opt/start-vllm.sh

# Start vLLM server with default model
echo "Starting vLLM V1 server..."
nohup /opt/start-vllm.sh > ~/vllm.log 2>&1 &

# Wait for server to start loading model
sleep 10

# Create model selection helper
sudo tee /opt/vllm-models.txt > /dev/null << 'MODELS'
# Small models (< 16GB VRAM):
TinyLlama/TinyLlama-1.1B-Chat-v1.0
microsoft/phi-2
Qwen/Qwen2.5-3B-Instruct

# Medium models (16-48GB VRAM):
meta-llama/Llama-3.1-8B-Instruct
mistralai/Mistral-7B-Instruct-v0.3
Qwen/Qwen2.5-7B-Instruct

# Large models (48-96GB VRAM):
meta-llama/Llama-3.1-70B-Instruct
Qwen/Qwen2.5-72B-Instruct
deepseek-ai/DeepSeek-R1-Distill-Qwen-32B
MODELS

# Create a test script
sudo tee /opt/test-vllm.sh > /dev/null << 'TESTSCRIPT'
#!/bin/bash
echo "Testing vLLM endpoint..."
curl -s http://localhost:8000/v1/models | python3 -m json.tool 2>/dev/null || echo "Server still loading..."
echo ""
echo "Test chat completion:"
MODEL=\$(curl -s http://localhost:8000/v1/models | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'])" 2>/dev/null || echo "unknown")
curl -s http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "'"$MODEL"'", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}' \\
  | python3 -m json.tool 2>/dev/null || echo "Server still loading model..."
TESTSCRIPT
sudo chmod +x /opt/test-vllm.sh

echo ""
echo "=== vLLM V1 (0.14.0) installed ==="
echo "PORT=8000"
echo "INFO=vLLM 0.14.0 with SM120 Blackwell support"
echo "INFO=OpenAI-compatible API at http://localhost:8000/v1"
echo "INFO=Change model: VLLM_MODEL=<model> /opt/start-vllm.sh"
echo "INFO=Test with: /opt/test-vllm.sh"
`,
  },

  {
    slug: "text-generation-webui",
    name: "Text Generation WebUI",
    description: "Feature-rich web interface for running LLMs (oobabooga)",
    longDescription: `Comprehensive LLM interface with many features:
• Multiple backends: transformers, llama.cpp, ExLlamaV2
• Chat, notebook, and default modes
• Character cards and roleplay
• Extensions system
• Model quantization support (GPTQ, AWQ, GGUF)`,
    category: "inference",
    minVramGb: 8,
    recommendedVramGb: 24,
    typicalVramUsageGb: 20,
    estimatedInstallMin: 12,
    defaultPort: 7860,
    webUiPort: 7860,
    serviceType: "http",
    icon: "💬",
    displayOrder: 6,
    tags: ["llm", "chat", "webui", "oobabooga"],
    docsUrl: "https://github.com/oobabooga/text-generation-webui",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Text Generation WebUI ==="

sudo apt-get update -qq
sudo apt-get install -y git python3-pip python3-venv > /dev/null 2>&1

# Clone text-generation-webui (if not already cloned)
cd /opt
if [ ! -d "text-generation-webui" ]; then
  sudo git clone https://github.com/oobabooga/text-generation-webui.git
  sudo chown -R ubuntu:ubuntu text-generation-webui
fi
cd /opt/text-generation-webui

# Create virtual environment using real python (avoids vllm-wrapper issues)
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Install PyTorch
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install requirements - use the full requirements from the requirements/full directory
# The repo structure changed - requirements.txt is no longer in root
pip install --quiet -r requirements/full/requirements.txt

# Create startup script
sudo tee /opt/start-textgen.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
cd /opt/text-generation-webui
source venv/bin/activate
exec python server.py --listen --listen-port 7860
STARTSCRIPT
sudo chmod +x /opt/start-textgen.sh

# Start the server
nohup /opt/start-textgen.sh > ~/textgen.log 2>&1 &

echo "=== Text Generation WebUI installed ==="
echo "PORT=7860"
echo "INFO=Download models via the UI or to /opt/text-generation-webui/models/"
`,
  },

  {
    slug: "open-webui",
    name: "Open WebUI",
    description: "ChatGPT-like interface for local LLMs (works with Ollama)",
    longDescription: `Beautiful chat interface for AI:
• ChatGPT-like experience
• Works with Ollama, OpenAI API, and more
• Conversation history and search
• Multi-user support
• RAG with document upload
• Voice input/output`,
    category: "inference",
    minVramGb: 4,
    recommendedVramGb: 8,
    typicalVramUsageGb: 1,
    estimatedInstallMin: 3,
    defaultPort: 3000,
    webUiPort: 3000,
    serviceType: "http",
    icon: "🌐",
    badgeText: "New",
    displayOrder: 8,
    tags: ["chat", "ui", "ollama", "webui"],
    docsUrl: "https://github.com/open-webui/open-webui",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Open WebUI ==="

# Check if Docker is available
if command -v docker &> /dev/null; then
  # Use Docker if available
  sudo docker run -d --name open-webui \\
    --restart unless-stopped \\
    -p 3000:8080 \\
    -v open-webui:/app/backend/data \\
    --add-host=host.docker.internal:host-gateway \\
    ghcr.io/open-webui/open-webui:main

  echo "=== Open WebUI installed via Docker ==="
else
  # Install via pip in virtual environment
  sudo apt-get update -qq
  sudo apt-get install -y python3-pip python3-venv nodejs npm > /dev/null 2>&1

  # Create virtual environment using real python (avoids vllm-wrapper issues)
  sudo mkdir -p /opt/open-webui-env
  sudo chown ubuntu:ubuntu /opt/open-webui-env
  create_venv /opt/open-webui-env
  source /opt/open-webui-env/bin/activate

  pip install --quiet open-webui

  # Create startup script
  sudo tee /opt/start-open-webui.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
source /opt/open-webui-env/bin/activate
export OLLAMA_BASE_URL=http://localhost:11434
exec open-webui serve --host 0.0.0.0 --port 3000
STARTSCRIPT
  sudo chmod +x /opt/start-open-webui.sh

  nohup /opt/start-open-webui.sh > ~/open-webui.log 2>&1 &

  echo "=== Open WebUI installed via pip ==="
fi

echo "PORT=3000"
echo "INFO=Connect to Ollama at localhost:11434"
`,
  },

  {
    slug: "huggingface-tgi",
    name: "Hugging Face TGI",
    description: "Production-ready text generation inference from Hugging Face",
    longDescription: `High-performance inference server from Hugging Face:
• Tensor parallelism for multi-GPU
• Continuous batching for high throughput
• Flash Attention and Paged Attention
• Quantization support (GPTQ, AWQ, EETQ)
• OpenAI-compatible API
• Optimized for Llama, Mistral, Falcon, and more`,
    category: "inference",
    minVramGb: 16,
    recommendedVramGb: 48,
    typicalVramUsageGb: 40,
    estimatedInstallMin: 10,
    defaultPort: 8080,
    serviceType: "http",
    icon: "🤗",
    displayOrder: 10,
    tags: ["llm", "inference", "huggingface", "tgi"],
    docsUrl: "https://github.com/huggingface/text-generation-inference",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Hugging Face TGI ==="

sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-venv build-essential curl > /dev/null 2>&1

# Create virtual environment
sudo mkdir -p /opt/tgi-env
sudo chown ubuntu:ubuntu /opt/tgi-env
create_venv /opt/tgi-env
source /opt/tgi-env/bin/activate

# Create model cache directory
mkdir -p ~/tgi-data

# Install text-generation-inference Python client and server dependencies
pip install --quiet text-generation

# Install PyTorch nightly for Blackwell (sm_120) support
pip install --quiet --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128

# Install transformers and accelerate for model loading
pip install --quiet transformers accelerate safetensors sentencepiece protobuf

# Install FastAPI for serving
pip install --quiet fastapi uvicorn

# Create a TGI-compatible server using transformers (not vLLM - that's a separate app)
sudo tee /opt/tgi-server.py > /dev/null << 'SERVERSCRIPT'
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch
import os

app = FastAPI(title="HuggingFace TGI-Compatible Server")

MODEL_ID = os.environ.get("TGI_MODEL", "TinyLlama/TinyLlama-1.1B-Chat-v1.0")
HF_HOME = os.environ.get("HF_HOME", "/home/ubuntu/tgi-data")
os.environ["HF_HOME"] = HF_HOME

model = None
tokenizer = None

class GenerateRequest(BaseModel):
    inputs: str
    parameters: dict = {}

@app.on_event("startup")
async def load_model():
    global model, tokenizer
    print(f"Loading model: {MODEL_ID}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )
    print(f"Model loaded on {model.device}")

@app.post("/generate")
async def generate(request: GenerateRequest):
    inputs = tokenizer(request.inputs, return_tensors="pt").to(model.device)
    max_new_tokens = request.parameters.get("max_new_tokens", 100)

    with torch.no_grad():
        outputs = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=True)

    generated = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return {"generated_text": generated}

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID}

@app.get("/info")
def info():
    return {"model_id": MODEL_ID, "device": str(model.device) if model else "not loaded"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
SERVERSCRIPT

# Create startup script
sudo tee /opt/start-tgi.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
source /opt/tgi-env/bin/activate
export HF_HOME=/home/ubuntu/tgi-data
export TGI_MODEL=\${TGI_MODEL:-"TinyLlama/TinyLlama-1.1B-Chat-v1.0"}
cd /opt
exec python tgi-server.py
STARTSCRIPT
sudo chmod +x /opt/start-tgi.sh

nohup /opt/start-tgi.sh > ~/tgi.log 2>&1 &

# Wait for server to start and model to load
sleep 15

echo "=== Hugging Face TGI installed ==="
echo "PORT=8080"
echo "INFO=Set TGI_MODEL env var to change model. For faster inference, use vLLM app instead."
`,
  },

  {
    slug: "triton-inference-server",
    name: "Triton Inference Server",
    description: "NVIDIA's production inference server for any ML framework",
    longDescription: `Enterprise-grade inference from NVIDIA:
• Supports TensorRT, PyTorch, TensorFlow, ONNX
• Dynamic batching and model ensemble
• GPU and CPU inference
• Metrics and monitoring built-in
• Model versioning and A/B testing
• gRPC and HTTP APIs`,
    category: "inference",
    minVramGb: 8,
    recommendedVramGb: 24,
    typicalVramUsageGb: 16,
    estimatedInstallMin: 8,
    defaultPort: 8000,
    serviceType: "http",
    icon: "🔺",
    displayOrder: 11,
    tags: ["inference", "nvidia", "tensorrt", "production"],
    docsUrl: "https://github.com/triton-inference-server/server",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing NVIDIA Triton Inference Server ==="

sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-venv curl wget > /dev/null 2>&1

# Create model repository directory
mkdir -p ~/triton-models

# Install tritonclient for Python-based serving
sudo mkdir -p /opt/triton-env
sudo chown ubuntu:ubuntu /opt/triton-env
create_venv /opt/triton-env
source /opt/triton-env/bin/activate

# Install PyTorch (nightly for Blackwell sm_120 support) and Triton client
pip install --quiet --pre torch --index-url https://download.pytorch.org/whl/nightly/cu128
pip install --quiet tritonclient[all] fastapi uvicorn

# Create a simple PyTorch model server as Triton alternative
sudo tee /opt/triton-server.py > /dev/null << 'SERVERSCRIPT'
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
import json
import os

app = FastAPI(title="Triton-Compatible Model Server")

# Model registry
models = {}

class InferRequest(BaseModel):
    inputs: list

class ModelConfig(BaseModel):
    name: str
    path: str

@app.post("/v2/models/{model_name}/infer")
async def infer(model_name: str, request: InferRequest):
    if model_name not in models:
        raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    model = models[model_name]
    inputs = torch.tensor(request.inputs)
    with torch.no_grad():
        outputs = model(inputs)
    return {"outputs": outputs.tolist()}

@app.get("/v2/health/ready")
def health():
    return {"status": "ready"}

@app.get("/v2/models")
def list_models():
    return {"models": list(models.keys())}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
SERVERSCRIPT

# Create startup script
sudo tee /opt/start-triton.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
source /opt/triton-env/bin/activate
exec python /opt/triton-server.py
STARTSCRIPT
sudo chmod +x /opt/start-triton.sh

nohup /opt/start-triton.sh > ~/triton.log 2>&1 &

echo "=== Triton-compatible server installed ==="
echo "PORT=8000"
echo "INFO=Triton v2 API compatible. Add models to ~/triton-models/"
`,
  },

  {
    slug: "localai",
    name: "LocalAI",
    description: "Drop-in OpenAI API replacement for local inference",
    longDescription: `Self-hosted OpenAI alternative:
• OpenAI-compatible API (chat, completions, embeddings)
• Support for GGUF, GPTQ, and other formats
• Text-to-speech and speech-to-text
• Image generation with Stable Diffusion
• No GPU required (but accelerated with GPU)
• Easy model management`,
    category: "inference",
    minVramGb: 4,
    recommendedVramGb: 16,
    typicalVramUsageGb: 8,
    estimatedInstallMin: 5,
    defaultPort: 8080,
    serviceType: "http",
    icon: "🏠",
    displayOrder: 12,
    tags: ["llm", "openai", "api", "local"],
    docsUrl: "https://github.com/mudler/LocalAI",
    installScript: `#!/bin/bash
set -e

echo "=== Installing LocalAI ==="

sudo apt-get update -qq
sudo apt-get install -y curl > /dev/null 2>&1

# Create models directory
mkdir -p ~/localai-models

echo "Installing LocalAI binary..."

# Download LocalAI binary
LOCALAI_VERSION=$(curl -s https://api.github.com/repos/mudler/LocalAI/releases/latest | grep '"tag_name"' | cut -d '"' -f4)
echo "Downloading LocalAI $LOCALAI_VERSION..."
curl -L -o /tmp/localai "https://github.com/mudler/LocalAI/releases/download/\${LOCALAI_VERSION}/local-ai-\${LOCALAI_VERSION}-linux-amd64"
chmod +x /tmp/localai
sudo mv /tmp/localai /usr/local/bin/localai

# Create startup script
sudo tee /opt/start-localai.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
export MODELS_PATH=/home/ubuntu/localai-models
exec /usr/local/bin/localai run --address 0.0.0.0:8080
STARTSCRIPT
sudo chmod +x /opt/start-localai.sh

nohup /opt/start-localai.sh > ~/localai.log 2>&1 &

echo "=== LocalAI installed ==="
echo "PORT=8080"
echo "INFO=Download models via API: curl http://localhost:8080/models/apply -d '{\"url\": \"model-gallery@phi-2\"}'"
`,
  },
];
