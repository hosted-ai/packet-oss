/**
 * GPU Apps - Creative Category
 *
 * Creative/image/video generation apps: ComfyUI, A1111, Fooocus, CogVideoX
 *
 * @module lib/gpu-apps/apps/creative
 */

import { type GpuAppDefinition, SCRIPT_PREAMBLE } from "./types";

export const CREATIVE_APPS: GpuAppDefinition[] = [
  {
    slug: "comfyui",
    name: "ComfyUI",
    description: "Node-based Stable Diffusion interface for image generation",
    longDescription: `Powerful visual workflow for AI image generation:
• Node-based interface for complex workflows
• Stable Diffusion XL, SD 1.5, FLUX support
• ControlNet, LoRA, IP-Adapter integration
• Batch processing and automation
• Save and share workflows`,
    category: "creative",
    minVramGb: 8,
    recommendedVramGb: 24,
    typicalVramUsageGb: 12,
    estimatedInstallMin: 10,
    defaultPort: 8188,
    serviceType: "http",
    icon: "🎨",
    badgeText: "Creative",
    displayOrder: 5,
    tags: ["stable-diffusion", "image", "art", "comfyui"],
    docsUrl: "https://github.com/comfyanonymous/ComfyUI",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing ComfyUI ==="

sudo apt-get update -qq
sudo apt-get install -y git python3-pip python3-venv > /dev/null 2>&1

# Clone ComfyUI
cd /opt
if [ ! -d "ComfyUI" ]; then
  sudo git clone https://github.com/comfyanonymous/ComfyUI.git
  sudo chown -R ubuntu:ubuntu ComfyUI
fi
cd ComfyUI

# Create virtual environment using real python (avoids vllm-wrapper issues)
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Install PyTorch and requirements
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
pip install --quiet -r requirements.txt

# Create startup script
sudo tee /opt/start-comfyui.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
cd /opt/ComfyUI
source venv/bin/activate
exec python main.py --listen 0.0.0.0 --port 8188
STARTSCRIPT
sudo chmod +x /opt/start-comfyui.sh

# Start ComfyUI
nohup /opt/start-comfyui.sh > ~/comfyui.log 2>&1 &

echo "=== ComfyUI installed ==="
echo "PORT=8188"
echo "INFO=Download models to /opt/ComfyUI/models/"
`,
  },

  {
    slug: "automatic1111",
    name: "Automatic1111 WebUI",
    description: "The most popular Stable Diffusion web interface",
    longDescription: `Feature-packed Stable Diffusion interface:
• SD 1.5, SDXL, and custom models
• Inpainting and outpainting
• ControlNet integration
• LoRA and textual inversion
• img2img and batch processing
• Extensive extension ecosystem`,
    category: "creative",
    minVramGb: 8,
    recommendedVramGb: 16,
    typicalVramUsageGb: 10,
    estimatedInstallMin: 15,
    defaultPort: 7860,
    webUiPort: 7860,
    serviceType: "http",
    icon: "🖼️",
    badgeText: "Popular",
    displayOrder: 13,
    tags: ["stable-diffusion", "image", "art", "a1111"],
    docsUrl: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Automatic1111 Stable Diffusion WebUI ==="

sudo apt-get update -qq
# Install required dependencies including build tools for Pillow and SSL for tokenizers
sudo apt-get install -y git python3-pip python3-venv wget libgl1 libglib2.0-0 \\
  libjpeg-dev zlib1g-dev libpng-dev libfreetype6-dev liblcms2-dev \\
  libwebp-dev libtiff5-dev libopenjp2-7-dev libimagequant-dev libraqm-dev \\
  libxcb1-dev build-essential curl libssl-dev pkg-config > /dev/null 2>&1

# Clone the main repository
cd /opt
if [ ! -d "stable-diffusion-webui" ]; then
  sudo git clone --depth 1 https://github.com/AUTOMATIC1111/stable-diffusion-webui.git
  sudo chown -R ubuntu:ubuntu stable-diffusion-webui
fi
cd stable-diffusion-webui

# Pre-clone required repositories to avoid runtime cloning issues
mkdir -p repositories
cd repositories
if [ ! -d "stable-diffusion-stability-ai" ]; then
  git clone --depth 1 https://github.com/Stability-AI/stablediffusion.git stable-diffusion-stability-ai || echo "Warning: Could not clone Stability-AI repo"
fi
if [ ! -d "stable-diffusion-webui-assets" ]; then
  git clone --depth 1 https://github.com/AUTOMATIC1111/stable-diffusion-webui-assets.git || echo "Warning: Could not clone assets repo"
fi
if [ ! -d "generative-models" ]; then
  git clone --depth 1 https://github.com/Stability-AI/generative-models.git || echo "Warning: Could not clone generative-models repo"
fi
if [ ! -d "k-diffusion" ]; then
  git clone --depth 1 https://github.com/crowsonkb/k-diffusion.git || echo "Warning: Could not clone k-diffusion repo"
fi
if [ ! -d "BLIP" ]; then
  git clone --depth 1 https://github.com/salesforce/BLIP.git || echo "Warning: Could not clone BLIP repo"
fi
cd ..

# Create virtual environment
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Upgrade pip to get prebuilt wheels when available
pip install --quiet --upgrade pip wheel

# Install PyTorch nightly for Blackwell GPU (sm_120) support
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Pre-install transformers and tokenizers from prebuilt wheels (avoid old pinned version that needs Rust build)
pip install --quiet tokenizers transformers safetensors accelerate

# Install requirements, skipping the transformers line to use newer compatible version
grep -v "^transformers==" requirements_versions.txt | pip install --quiet -r /dev/stdin || true

# Create startup script with proper arguments
sudo tee /opt/start-a1111.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
cd /opt/stable-diffusion-webui
source venv/bin/activate
exec python launch.py --listen --port 7860 --enable-insecure-extension-access --api --skip-torch-cuda-test --skip-python-version-check
STARTSCRIPT
sudo chmod +x /opt/start-a1111.sh

# Start the WebUI
nohup /opt/start-a1111.sh > ~/a1111.log 2>&1 &

# Wait for server to start
sleep 10

echo "=== Automatic1111 WebUI installed ==="
echo "PORT=7860"
echo "INFO=Download models to /opt/stable-diffusion-webui/models/Stable-diffusion/"
`,
  },

  {
    slug: "fooocus",
    name: "Fooocus",
    description: "Simplified Stable Diffusion with Midjourney-like UX",
    longDescription: `Streamlined image generation:
• Midjourney-like simple interface
• Automatic prompt enhancement
• SDXL optimized out of the box
• Minimal configuration needed
• Style presets included
• Inpaint and outpaint support`,
    category: "creative",
    minVramGb: 8,
    recommendedVramGb: 12,
    typicalVramUsageGb: 10,
    estimatedInstallMin: 10,
    defaultPort: 7865,
    webUiPort: 7865,
    serviceType: "http",
    icon: "🎯",
    badgeText: "Easy",
    displayOrder: 14,
    tags: ["stable-diffusion", "image", "art", "simple"],
    docsUrl: "https://github.com/lllyasviel/Fooocus",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing Fooocus ==="

sudo apt-get update -qq
sudo apt-get install -y git python3-pip python3-venv libgl1 libglib2.0-0 > /dev/null 2>&1

# Clone Fooocus
cd /opt
if [ ! -d "Fooocus" ]; then
  sudo git clone https://github.com/lllyasviel/Fooocus.git
  sudo chown -R ubuntu:ubuntu Fooocus
fi
cd Fooocus

# Create virtual environment
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Install PyTorch
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install requirements
pip install --quiet -r requirements_versions.txt

# Create startup script
sudo tee /opt/start-fooocus.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
cd /opt/Fooocus
source venv/bin/activate
exec python entry_with_update.py --listen --port 7865
STARTSCRIPT
sudo chmod +x /opt/start-fooocus.sh

# Start Fooocus
nohup /opt/start-fooocus.sh > ~/fooocus.log 2>&1 &

# Wait for server to start
sleep 5

echo "=== Fooocus installed ==="
echo "PORT=7865"
echo "INFO=Models auto-download on first use"
`,
  },

  {
    slug: "cogvideox",
    name: "CogVideoX",
    description: "State-of-the-art AI video generation",
    longDescription: `Advanced video generation from Tsinghua:
• Text-to-video generation
• High quality 720p output
• 6-second video clips
• Multiple style options
• Based on diffusion models
• Requires significant VRAM`,
    category: "creative",
    minVramGb: 24,
    recommendedVramGb: 48,
    typicalVramUsageGb: 40,
    estimatedInstallMin: 15,
    defaultPort: 7860,
    webUiPort: 7860,
    serviceType: "http",
    icon: "🎬",
    badgeText: "New",
    displayOrder: 17,
    tags: ["video", "generation", "ai", "creative"],
    docsUrl: "https://github.com/THUDM/CogVideo",
    installScript: SCRIPT_PREAMBLE + `
echo "=== Installing CogVideoX ==="

sudo apt-get update -qq
sudo apt-get install -y git python3-pip python3-venv ffmpeg > /dev/null 2>&1

# Clone CogVideo
cd /opt
if [ ! -d "CogVideo" ]; then
  sudo git clone https://github.com/THUDM/CogVideo.git
  sudo chown -R ubuntu:ubuntu CogVideo
fi
cd CogVideo

# Create virtual environment
if [ ! -d "venv" ]; then
  create_venv venv
fi
source venv/bin/activate

# Install PyTorch
pip install --quiet --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install requirements
pip install --quiet -r requirements.txt

# Install Gradio and diffusers for web interface
pip install --quiet gradio diffusers transformers accelerate

# Create a simple Gradio interface
sudo tee /opt/cogvideo-ui.py > /dev/null << 'UISCRIPT'
import gradio as gr
import torch
from diffusers import CogVideoXPipeline
from diffusers.utils import export_to_video

# Load model (will download on first run)
pipe = None

def load_model():
    global pipe
    if pipe is None:
        pipe = CogVideoXPipeline.from_pretrained(
            "THUDM/CogVideoX-2b",
            torch_dtype=torch.float16
        ).to("cuda")
        pipe.enable_model_cpu_offload()
    return pipe

def generate_video(prompt, num_frames=49, guidance_scale=6.0):
    model = load_model()
    video = model(
        prompt=prompt,
        num_frames=num_frames,
        guidance_scale=guidance_scale,
    ).frames[0]

    output_path = "/tmp/output.mp4"
    export_to_video(video, output_path, fps=8)
    return output_path

demo = gr.Interface(
    fn=generate_video,
    inputs=[
        gr.Textbox(label="Prompt", placeholder="A cat playing piano..."),
        gr.Slider(minimum=17, maximum=49, value=49, step=8, label="Frames"),
        gr.Slider(minimum=1, maximum=15, value=6, step=0.5, label="Guidance Scale"),
    ],
    outputs=gr.Video(label="Generated Video"),
    title="CogVideoX Video Generator",
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
UISCRIPT

# Create startup script
sudo tee /opt/start-cogvideo.sh > /dev/null << 'STARTSCRIPT'
#!/bin/bash
cd /opt/CogVideo
source venv/bin/activate
exec python /opt/cogvideo-ui.py
STARTSCRIPT
sudo chmod +x /opt/start-cogvideo.sh

nohup /opt/start-cogvideo.sh > ~/cogvideo.log 2>&1 &

# Wait for server to start
sleep 5

echo "=== CogVideoX installed ==="
echo "PORT=7860"
echo "INFO=Model downloads on first use (~10GB)"
`,
  },
];
