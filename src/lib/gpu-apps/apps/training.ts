/**
 * GPU Apps - Training Category
 *
 * Training apps: Axolotl, Kohya_ss
 *
 * @module lib/gpu-apps/apps/training
 */

import { type GpuAppDefinition, SCRIPT_PREAMBLE } from "./types";

export const TRAINING_APPS: GpuAppDefinition[] = [
  {
    slug: "axolotl-training",
    name: "Axolotl Fine-tuning",
    description: "Fine-tune LLMs with LoRA, QLoRA, and full fine-tuning",
    longDescription: `Streamlined fine-tuning toolkit:
• LoRA, QLoRA, and full fine-tuning
• Support for Llama, Mistral, Phi, and more
• YAML-based configuration
• Weights & Biases integration
• FlashAttention support
• Multi-GPU training ready`,
    category: "training",
    minVramGb: 24,
    recommendedVramGb: 48,
    typicalVramUsageGb: 40,
    estimatedInstallMin: 8,
    icon: "🔧",
    displayOrder: 7,
    tags: ["fine-tuning", "lora", "qlora", "training"],
    docsUrl: "https://github.com/OpenAccess-AI-Collective/axolotl",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Axolotl Fine-tuning ==="

sudo apt-get update -qq
sudo apt-get install -y git python3-pip python3-venv > /dev/null 2>&1

# Clone Axolotl
cd /opt
if [ ! -d "axolotl" ]; then
  sudo git clone https://github.com/OpenAccess-AI-Collective/axolotl.git
  sudo chown -R ubuntu:ubuntu axolotl
fi
cd axolotl

# Create virtual environment using real python (avoids vllm-wrapper issues)
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Install PyTorch FIRST (required by axolotl's setup.py)
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install build dependencies
pip install --quiet packaging ninja wheel setuptools

# Install Axolotl (torch must be installed first as setup.py imports it)
pip install --quiet -e '.[flash-attn,deepspeed]'

# Create example config directory
mkdir -p /home/ubuntu/axolotl-configs
cp -r examples/* /home/ubuntu/axolotl-configs/ 2>/dev/null || true

echo "=== Axolotl installed ==="
echo "INFO=Example configs in /home/ubuntu/axolotl-configs/"
echo "INFO=Run: cd /opt/axolotl && source venv/bin/activate && accelerate launch -m axolotl.cli.train your_config.yml"
`,
  },

  {
    slug: "kohya-ss",
    name: "Kohya_ss GUI",
    description: "LoRA and fine-tuning for Stable Diffusion models",
    longDescription: `Comprehensive SD training toolkit:
• LoRA training for SD 1.5 and SDXL
• DreamBooth and native fine-tuning
• Dataset preparation tools
• Captioning assistance
• Training presets and templates
• VRAM-efficient training options`,
    category: "training",
    minVramGb: 12,
    recommendedVramGb: 24,
    typicalVramUsageGb: 18,
    estimatedInstallMin: 12,
    defaultPort: 7860,
    webUiPort: 7860,
    serviceType: "http",
    icon: "🎓",
    displayOrder: 15,
    tags: ["lora", "training", "stable-diffusion", "fine-tuning"],
    docsUrl: "https://github.com/bmaltais/kohya_ss",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Kohya_ss GUI ==="

sudo apt-get update -qq
sudo apt-get install -y git python3-pip python3-venv python3-tk libgl1 libglib2.0-0 > /dev/null 2>&1

# Clone kohya_ss
cd /opt
if [ ! -d "kohya_ss" ]; then
  sudo git clone https://github.com/bmaltais/kohya_ss.git
  sudo chown -R ubuntu:ubuntu kohya_ss
fi
cd kohya_ss

# Create virtual environment
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Install PyTorch
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install requirements
pip install --quiet -r requirements.txt

# Install additional training dependencies
pip install --quiet xformers bitsandbytes accelerate

# Create startup script
sudo tee /opt/start-kohya.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
cd /opt/kohya_ss
source venv/bin/activate
exec python kohya_gui.py --listen 0.0.0.0 --server_port 7860 --headless
STARTSCRIPT
sudo chmod +x /opt/start-kohya.sh

# Start Kohya
nohup /opt/start-kohya.sh > ~/kohya.log 2>&1 &

# Wait for server to start
sleep 5

echo "=== Kohya_ss GUI installed ==="
echo "PORT=7860"
echo "INFO=Use the GUI to train LoRA and fine-tune SD models"
`,
  },
];
