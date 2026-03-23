# Axolotl Training Recipe

One-click deployment of Axolotl for LLM fine-tuning with LoRA, QLoRA, and full fine-tuning support.

## What Gets Installed
- Axolotl (OpenAccess-AI-Collective/axolotl) with flash-attn and DeepSpeed
- PyTorch with CUDA 12.8 support
- Example training configs in /home/ubuntu/axolotl-configs/
- Convenience wrapper scripts (axolotl-train, axolotl-preprocess)

## Ports
No web UI -- this is a CLI-based training tool.

## Resource Requirements
- **Minimum VRAM**: 16 GB (for LoRA/QLoRA fine-tuning)
- **Recommended VRAM**: 40 GB+ (for full fine-tuning of 7B+ models)
- **Disk**: 50 GB + model and dataset storage

## Post-Deploy Usage
```bash
# Preprocess a dataset
axolotl-preprocess /home/ubuntu/axolotl-configs/llama-2/lora.yml

# Start a training run
axolotl-train /home/ubuntu/axolotl-configs/llama-2/lora.yml

# Or activate the venv directly
source /opt/axolotl/venv/bin/activate
accelerate launch -m axolotl.cli.train your_config.yml
```

## Testing
1. Verify installation: `/opt/axolotl/venv/bin/python -c "import axolotl; print('OK')"`
2. List example configs: `ls /home/ubuntu/axolotl-configs/`
3. Run a dry-run training with a small config
