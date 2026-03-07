# HuggingFace Model Deployment

Deploy HuggingFace models with one click. Get an OpenAI-compatible API endpoint in minutes.

## Overview

The platform's HuggingFace integration automatically:

1. Provisions a GPU instance
2. Downloads your selected model
3. Starts a vLLM inference server
4. Exposes an OpenAI-compatible API endpoint

## Quick Start

1. Click **HuggingFace** in the sidebar
2. Search for a model (e.g., "Llama 3", "Mistral", "Qwen")
3. Select a model from the results
4. Choose your GPU configuration
5. Click **Deploy**

Your model will be ready in 5-10 minutes (depending on model size).

## Supported Models

We support most text-generation models on HuggingFace, including:

| Model Family | Example Models | Recommended GPU |
|--------------|----------------|-----------------|
| Llama 3 | meta-llama/Llama-3.1-8B-Instruct | 1x L4 (24GB) |
| Mistral | mistralai/Mistral-7B-Instruct-v0.3 | 1x L4 (24GB) |
| Qwen | Qwen/Qwen2.5-7B-Instruct | 1x L4 (24GB) |
| DeepSeek | deepseek-ai/DeepSeek-R1-Distill-Qwen-7B | 1x L4 (24GB) |
| Phi | microsoft/Phi-3.5-mini-instruct | 1x L4 (24GB) |
| Gemma | google/gemma-2-9b-it | 1x L4 (24GB) |

### Large Models (Multi-GPU)

| Model | Size | GPUs Required |
|-------|------|---------------|
| Llama 3.1 70B | ~140GB | 4x L4 or 2x A100 |
| Mixtral 8x7B | ~90GB | 2-4x L4 |
| Qwen 72B | ~144GB | 4x L4 or 2x A100 |

## Using Your Deployed Model

Once deployed, you'll receive an API endpoint like:

```
http://35.190.160.152:20000/v1
```

### Chat Completions (OpenAI Compatible)

```bash
curl http://35.190.160.152:20000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.1-8B-Instruct",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://35.190.160.152:20000/v1",
    api_key="not-needed"  # No auth required
)

response = client.chat.completions.create(
    model="meta-llama/Llama-3.1-8B-Instruct",
    messages=[
        {"role": "user", "content": "Write a haiku about GPUs"}
    ]
)

print(response.choices[0].message.content)
```

### Streaming Responses

```python
stream = client.chat.completions.create(
    model="meta-llama/Llama-3.1-8B-Instruct",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### JavaScript/TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://35.190.160.152:20000/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
```

## API Endpoints

Your vLLM server exposes these endpoints:

| Endpoint | Description |
|----------|-------------|
| `/v1/chat/completions` | Chat completions (recommended) |
| `/v1/completions` | Text completions |
| `/v1/models` | List available models |
| `/health` | Health check |

## Deployment Status

Your HuggingFace deployment goes through these stages:

1. **Pending** - GPU being provisioned
2. **Deploying** - Instance starting
3. **Installing** - Dependencies being installed
4. **Starting** - vLLM server starting, model loading
5. **Running** - Ready to accept requests

Model loading can take 2-10 minutes depending on model size.

## Monitoring

### Check Server Status

```bash
curl http://35.190.160.152:20000/health
```

### List Models

```bash
curl http://35.190.160.152:20000/v1/models
```

### View Logs

SSH into your instance and check:

```bash
tail -f ~/hf-workspace/vllm.log
```

## Configuration Options

### GPU Count

For larger models, increase GPU count during deployment:

- **1 GPU**: Models up to ~15B parameters
- **2 GPUs**: Models up to ~30B parameters
- **4 GPUs**: Models up to ~70B parameters
- **8 GPUs**: Models up to ~140B parameters

### Persistent Storage

Enable persistent storage to:
- Cache downloaded models (faster restarts)
- Save conversation logs
- Store fine-tuned adapters

## Advanced: Custom vLLM Arguments

SSH into your instance to restart vLLM with custom settings:

```bash
# Stop existing server
pkill -f vllm

# Start with custom args
python -m vllm.entrypoints.openai.api_server \
  --model your-model-id \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.9
```

Common options:
- `--tensor-parallel-size` - Number of GPUs for model parallelism
- `--max-model-len` - Maximum context length
- `--gpu-memory-utilization` - GPU memory fraction (default 0.9)
- `--quantization` - Enable quantization (awq, gptq, squeezellm)

## Troubleshooting

### Model Not Loading

Check logs for errors:

```bash
ssh -p <port> ubuntu@<host>
cat ~/hf-workspace/vllm.log
```

Common issues:
- **Out of memory**: Use more GPUs or a smaller model
- **Gated model**: Accept terms on HuggingFace website first
- **Network timeout**: Model download may still be in progress

### Slow Responses

- Check GPU utilization: `nvidia-smi`
- Reduce `--max-model-len` if memory is tight
- Use `--enforce-eager` mode for stability

### API Not Responding

1. Check if vLLM is running: `ps aux | grep vllm`
2. Check the port is exposed via Service Exposure
3. Restart vLLM if needed

## Pricing

HuggingFace deployments are billed at standard GPU rates:
- GPU compute: Per-hour based on GPU type
- Persistent storage: Per-hour based on size
- Network: Included

## Need Help?

Contact us at [support@example.com](mailto:support@example.com)
