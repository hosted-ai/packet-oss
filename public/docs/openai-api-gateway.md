# OpenAI-Compatible API Gateway

## Overview

The OpenAI-Compatible API Gateway provides a standardized interface for interacting with your deployed AI models using the same API format as OpenAI's GPT models. This means you can use existing OpenAI client libraries, tools, and integrations with your self-hosted models on GPU Cloud Platform.

### Prerequisites

Before using the API Gateway, ensure you have:

1. **An active GPU subscription** with a running pod
2. **vLLM deployed and running** on your pod (via Hugging Face deployment or manual setup)
3. **Port 8000 exposed as a service** using the "Expose Service" feature in your dashboard
4. **A GPU Cloud Platform API key** created in your dashboard under API Keys

### Why Use the API Gateway?

- **Drop-in Replacement**: Use existing OpenAI SDKs and tools without modification
- **Familiar Interface**: Same endpoints, request/response formats as OpenAI
- **Easy Migration**: Switch from OpenAI to self-hosted models with a URL change
- **Cost Control**: Pay for GPU time, not per-token API fees
- **Data Privacy**: Your data never leaves your infrastructure
- **Auto-Discovery**: Automatically finds your running vLLM instance

---

## 🚀 Quick Start

### 1. Get Your API Key

Create an API key in your dashboard under **Settings → API Keys**. Your key will look like:

```
pk_live_abc123...
```

### 2. Use the GPU Cloud Platform Proxy Endpoint

Point your OpenAI SDK to the GPU Cloud Platform API gateway:

```
https://YOUR_DOMAIN/api/v1
```

### 3. Make Your First Request

```bash
curl https://YOUR_DOMAIN/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_live_YOUR_API_KEY" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100
  }'
```

> **Note:** Use `"model": "auto"` or omit the model field to automatically use whichever model is running on your instance.

### 4. Use with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://YOUR_DOMAIN/api/v1",
    api_key="pk_live_YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="auto",  # Uses your deployed model
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

---

## 📡 API Endpoints

### Chat Completions

**Endpoint**: `POST /v1/chat/completions`

The primary endpoint for conversational AI interactions.

#### Request Body

```json
{
  "model": "meta-llama/Llama-3.1-70B-Instruct",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is machine learning?"}
  ],
  "max_tokens": 500,
  "temperature": 0.7,
  "top_p": 0.9,
  "stream": false,
  "stop": ["\n\n"],
  "presence_penalty": 0.0,
  "frequency_penalty": 0.0
}
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | required | Model identifier (HuggingFace model ID) |
| `messages` | array | required | Array of message objects with `role` and `content` |
| `max_tokens` | integer | 512 | Maximum tokens to generate |
| `temperature` | float | 1.0 | Sampling temperature (0.0-2.0) |
| `top_p` | float | 1.0 | Nucleus sampling probability |
| `stream` | boolean | false | Enable Server-Sent Events streaming |
| `stop` | string/array | null | Stop sequences |
| `presence_penalty` | float | 0.0 | Penalize new tokens based on presence |
| `frequency_penalty` | float | 0.0 | Penalize tokens based on frequency |
| `n` | integer | 1 | Number of completions to generate |
| `logprobs` | boolean | false | Return log probabilities |
| `top_logprobs` | integer | null | Number of top logprobs to return |

#### Response

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1705123456,
  "model": "meta-llama/Llama-3.1-70B-Instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Machine learning is a subset of artificial intelligence..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

---

### Text Completions (Legacy)

**Endpoint**: `POST /v1/completions`

For text completion (non-chat) use cases.

#### Request Body

```json
{
  "model": "meta-llama/Llama-3.1-70B-Instruct",
  "prompt": "The quick brown fox",
  "max_tokens": 50,
  "temperature": 0.7,
  "echo": false
}
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | required | Model identifier |
| `prompt` | string/array | required | Text prompt(s) |
| `max_tokens` | integer | 16 | Maximum tokens to generate |
| `temperature` | float | 1.0 | Sampling temperature |
| `top_p` | float | 1.0 | Nucleus sampling |
| `echo` | boolean | false | Echo back the prompt |
| `suffix` | string | null | Suffix to append |
| `best_of` | integer | 1 | Generate multiple and return best |

---

### List Models

**Endpoint**: `GET /v1/models`

List available models on your instance.

#### Response

```json
{
  "object": "list",
  "data": [
    {
      "id": "meta-llama/Llama-3.1-70B-Instruct",
      "object": "model",
      "created": 1705123456,
      "owned_by": "vllm",
      "permission": [],
      "root": "meta-llama/Llama-3.1-70B-Instruct",
      "parent": null
    }
  ]
}
```

---

### Health Check

**Endpoint**: `GET /health`

Check if the API server is running.

#### Response

```json
{
  "status": "healthy"
}
```

---

## 🔄 Streaming Responses

Enable real-time token streaming for better UX:

### Using curl

```bash
curl https://YOUR_ENDPOINT/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "meta-llama/Llama-3.1-70B-Instruct",
    "messages": [{"role": "user", "content": "Write a poem"}],
    "stream": true
  }'
```

### Using Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://YOUR_ENDPOINT/v1",
    api_key="YOUR_API_KEY"
)

stream = client.chat.completions.create(
    model="meta-llama/Llama-3.1-70B-Instruct",
    messages=[{"role": "user", "content": "Write a poem about AI"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Using JavaScript/TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://YOUR_ENDPOINT/v1',
  apiKey: 'YOUR_API_KEY',
});

async function streamChat() {
  const stream = await client.chat.completions.create({
    model: 'meta-llama/Llama-3.1-70B-Instruct',
    messages: [{ role: 'user', content: 'Write a poem about AI' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}
```

### Stream Event Format

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1705123456,"model":"meta-llama/Llama-3.1-70B-Instruct","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1705123456,"model":"meta-llama/Llama-3.1-70B-Instruct","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1705123456,"model":"meta-llama/Llama-3.1-70B-Instruct","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

---

## 🔐 Authentication

### API Key Authentication

If you started vLLM with `--api-key`:

```bash
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --api-key sk-your-secret-key
```

Include the key in requests:

```bash
curl https://YOUR_ENDPOINT/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "...", "messages": [...]}'
```

### Generating Secure API Keys

```bash
# Generate a random 64-character key
openssl rand -hex 32

# Example output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

### Environment Variable Setup

```bash
export VLLM_API_KEY="sk-your-secret-key"

python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --api-key $VLLM_API_KEY
```

---

## 💻 SDK Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

# Initialize client with GPU Cloud Platform gateway
client = OpenAI(
    base_url="https://YOUR_DOMAIN/api/v1",
    api_key="pk_live_YOUR_API_KEY"
)

# Chat completion
response = client.chat.completions.create(
    model="auto",  # Uses your deployed model
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Write a Python function to sort a list"}
    ],
    temperature=0.7,
    max_tokens=500
)

print(response.choices[0].message.content)
```

### JavaScript/TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://YOUR_DOMAIN/api/v1',
  apiKey: 'pk_live_YOUR_API_KEY',
});

async function chat() {
  const response = await client.chat.completions.create({
    model: 'auto',  // Uses your deployed model
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Explain quantum computing' },
    ],
  });

  console.log(response.choices[0].message.content);
}
```

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://YOUR_DOMAIN/api/v1",
    api_key="pk_live_YOUR_API_KEY",
    model="auto",
    temperature=0.7
)

response = llm.invoke("What is the meaning of life?")
print(response.content)
```

### LlamaIndex

```python
from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(
    api_base="https://YOUR_DOMAIN/api/v1",
    api_key="pk_live_YOUR_API_KEY",
    model="auto"
)

response = llm.complete("The future of AI is")
print(response.text)
```

### cURL

```bash
# Basic request
curl https://YOUR_DOMAIN/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_live_YOUR_API_KEY" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# With streaming
curl https://YOUR_DOMAIN/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_live_YOUR_API_KEY" \
  -N \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

---

## ⚙️ Configuration Options

### vLLM Server Options

```bash
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --max-model-len 8192 \
  --api-key sk-your-key \
  --trust-remote-code \
  --dtype float16 \
  --gpu-memory-utilization 0.95
```

| Option | Description |
|--------|-------------|
| `--host` | Host to bind (use `0.0.0.0` for external access) |
| `--port` | Port number (default: 8000) |
| `--tensor-parallel-size` | Number of GPUs for tensor parallelism |
| `--max-model-len` | Maximum sequence length |
| `--api-key` | API key for authentication |
| `--dtype` | Data type (float16, bfloat16, auto) |
| `--gpu-memory-utilization` | GPU memory fraction (0.0-1.0) |
| `--trust-remote-code` | Allow custom model code |

---

## 📊 Monitoring & Metrics

### Prometheus Metrics

vLLM exposes metrics at `/metrics`:

```bash
curl https://YOUR_ENDPOINT/metrics
```

Key metrics:
- `vllm:num_requests_running` - Current in-flight requests
- `vllm:num_requests_waiting` - Queued requests
- `vllm:gpu_cache_usage_perc` - KV cache utilization
- `vllm:request_latency_seconds` - Request latency histogram
- `vllm:token_throughput` - Tokens per second

### Health Monitoring

```bash
# Simple health check
curl https://YOUR_ENDPOINT/health

# Check model availability
curl https://YOUR_ENDPOINT/v1/models
```

---

## 🔧 Troubleshooting

### Common Issues

#### "No running inference endpoint found"
- Make sure you have an active GPU subscription with a running pod
- Deploy a model via Hugging Face deployment or manually start vLLM
- Expose port 8000 as a service (Dashboard → Your Pod → Expose Service)
- Wait for the vLLM server to fully start (check deployment logs)

#### "Connection refused" / Timeout
- Check if pod status is "Running" in your dashboard
- Verify vLLM is running on port 8000 inside your pod
- Wait for model to finish loading (check deployment logs)

#### "Authentication failed"
- Make sure you're using a valid GPU Cloud Platform API key (starts with `pk_live_`)
- Include the `Authorization: Bearer YOUR_KEY` header
- Check that your API key hasn't been revoked in the dashboard

#### "Model not found"
- Use `"model": "auto"` to automatically use your deployed model
- Or check exact model ID: `curl YOUR_POD_IP:PORT/v1/models`

#### "Out of memory"
- Reduce `--max-model-len` when starting vLLM
- Increase `--tensor-parallel-size` (multi-GPU)
- Use quantized model (AWQ, GPTQ)
- Lower `--gpu-memory-utilization`

#### "Slow responses"
- First request triggers model loading into GPU memory
- Subsequent requests will be much faster
- Enable persistent storage to cache models between restarts

---

## 🛡️ Security Best Practices

### Production Checklist

1. **Enable API Key Authentication**
   ```bash
   --api-key $(openssl rand -hex 32)
   ```

2. **Use HTTPS (LoadBalancer)**
   - Deploy with LoadBalancer type for TLS termination
   - Or use a reverse proxy (nginx, Caddy)

3. **Rate Limiting**
   - Implement at reverse proxy level
   - Or use `--max-num-seqs` to limit concurrent requests

4. **Network Security**
   - Restrict access with firewall rules
   - Use VPC/private networking when possible

5. **Monitoring**
   - Set up alerts for high latency
   - Monitor GPU memory usage
   - Track authentication failures

---

## 📚 Additional Resources

- [vLLM Documentation](https://docs.vllm.ai/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Service Exposure Guide](./service-exposure.md)
- [Pro 6000 Blackwell Templates](./pro-6000-blackwell.md)

---

**Last Updated**: January 2025 | **Version**: 1.0
