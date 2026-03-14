"use client";

export function HuggingFaceDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>HuggingFace Model Deployment</h1>
      <p className="lead">
        Deploy HuggingFace models with one click. Get an OpenAI-compatible API
        endpoint in minutes.
      </p>

      {/* Table of Contents */}
      <nav className="not-prose my-8 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">On this page</h4>
        <ul className="space-y-1.5 text-sm">
          <li><a href="#overview" className="text-blue-600 dark:text-blue-400 hover:underline">Overview</a></li>
          <li><a href="#quick-start" className="text-blue-600 dark:text-blue-400 hover:underline">Quick Start</a></li>
          <li><a href="#recommended-models" className="text-blue-600 dark:text-blue-400 hover:underline">Recommended Models</a></li>
          <li><a href="#deployment-options" className="text-blue-600 dark:text-blue-400 hover:underline">Deployment Options</a></li>
          <li><a href="#gated-models" className="text-blue-600 dark:text-blue-400 hover:underline">Gated Models</a></li>
          <li><a href="#using-your-model" className="text-blue-600 dark:text-blue-400 hover:underline">Using Your Deployed Model</a></li>
          <li><a href="#api-endpoints" className="text-blue-600 dark:text-blue-400 hover:underline">API Endpoints</a></li>
          <li><a href="#gpu-sizing" className="text-blue-600 dark:text-blue-400 hover:underline">GPU Sizing Guide</a></li>
          <li><a href="#monitoring" className="text-blue-600 dark:text-blue-400 hover:underline">Monitoring</a></li>
          <li><a href="#troubleshooting" className="text-blue-600 dark:text-blue-400 hover:underline">Troubleshooting</a></li>
        </ul>
      </nav>

      <h2 id="overview">Overview</h2>
      <p>The HuggingFace integration automatically:</p>
      <ol>
        <li>Provisions a GPU instance</li>
        <li>Downloads your selected model</li>
        <li>Starts a vLLM inference server</li>
        <li>Exposes an OpenAI-compatible API endpoint</li>
      </ol>

      <div className="not-prose bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 my-6">
        <h4 className="text-blue-800 dark:text-blue-200 font-semibold mb-2 text-base">Why vLLM?</h4>
        <p className="text-blue-700 dark:text-blue-300 text-sm mb-0">
          vLLM is the fastest open-source LLM inference engine, with PagedAttention for efficient memory management
          and continuous batching for maximum throughput. Your deployed models run 2-4x faster than naive implementations.
        </p>
      </div>

      <h2 id="quick-start">Quick Start</h2>
      <ol>
        <li>Click <strong>HuggingFace</strong> in the sidebar</li>
        <li>Search for a model or browse the catalog</li>
        <li>Select a model</li>
        <li>Choose your GPU configuration</li>
        <li>Click <strong>Deploy</strong></li>
      </ol>
      <p>Your model will be ready in 5-10 minutes (depending on model size).</p>

      <h2 id="recommended-models">Recommended Models</h2>
      <p>These models are tested and optimized for deployment on this platform:</p>

      <h3>General Purpose</h3>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Size</th>
            <th>Min GPUs</th>
            <th>Best For</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>meta-llama/Llama-3.1-8B-Instruct</code></td>
            <td>8B</td>
            <td>1x RTX 4090</td>
            <td>Fast general-purpose, coding, chat</td>
          </tr>
          <tr>
            <td><code>meta-llama/Llama-3.1-70B-Instruct</code></td>
            <td>70B</td>
            <td>4x RTX 4090</td>
            <td>High-quality reasoning, complex tasks</td>
          </tr>
          <tr>
            <td><code>mistralai/Mistral-7B-Instruct-v0.3</code></td>
            <td>7B</td>
            <td>1x RTX 4090</td>
            <td>Efficient, fast inference</td>
          </tr>
          <tr>
            <td><code>Qwen/Qwen2.5-7B-Instruct</code></td>
            <td>7B</td>
            <td>1x RTX 4090</td>
            <td>Multilingual, math, coding</td>
          </tr>
          <tr>
            <td><code>google/gemma-2-9b-it</code></td>
            <td>9B</td>
            <td>1x RTX 4090</td>
            <td>Instruction following, creative</td>
          </tr>
        </tbody>
      </table>

      <h3>Coding Specialists</h3>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Size</th>
            <th>Min GPUs</th>
            <th>Best For</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>Qwen/Qwen2.5-Coder-7B-Instruct</code></td>
            <td>7B</td>
            <td>1x RTX 4090</td>
            <td>Code generation, completion</td>
          </tr>
          <tr>
            <td><code>deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct</code></td>
            <td>16B MoE</td>
            <td>1x RTX 4090</td>
            <td>Advanced code reasoning</td>
          </tr>
          <tr>
            <td><code>codellama/CodeLlama-7b-Instruct-hf</code></td>
            <td>7B</td>
            <td>1x RTX 4090</td>
            <td>Code infilling, completion</td>
          </tr>
        </tbody>
      </table>

      <h3>Small & Fast</h3>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Size</th>
            <th>Min GPUs</th>
            <th>Best For</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>microsoft/Phi-3.5-mini-instruct</code></td>
            <td>3.8B</td>
            <td>1x RTX 4090</td>
            <td>Ultra-fast, efficient</td>
          </tr>
          <tr>
            <td><code>HuggingFaceH4/zephyr-7b-beta</code></td>
            <td>7B</td>
            <td>1x RTX 4090</td>
            <td>Chat, assistant</td>
          </tr>
        </tbody>
      </table>

      <h2 id="deployment-options">Deployment Options</h2>
      <p>When deploying, you can configure:</p>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Description</th>
            <th>Recommendation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>GPU Pool</strong></td>
            <td>Select from available GPU types</td>
            <td>RTX 4090 for 7B models, A100 for 70B+</td>
          </tr>
          <tr>
            <td><strong>GPU Count</strong></td>
            <td>Number of GPUs (1-8)</td>
            <td>See GPU sizing guide below</td>
          </tr>
          <tr>
            <td><strong>Persistent Storage</strong></td>
            <td>Cache models for faster restarts</td>
            <td>Enable for frequently used models</td>
          </tr>
          <tr>
            <td><strong>HuggingFace Token</strong></td>
            <td>Required for gated models</td>
            <td>Required for Llama, Gemma, etc.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="gated-models">Gated Models</h2>
      <p>
        Some models on HuggingFace require accepting terms before use. These include
        Llama, Gemma, and other popular models.
      </p>

      <h3>Setup Steps</h3>
      <ol>
        <li>
          <strong>Accept License</strong>: Visit the model page on HuggingFace and click &quot;Agree and access repository&quot;
          <ul>
            <li><a href="https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct" target="_blank" rel="noopener">Llama 3.1</a></li>
            <li><a href="https://huggingface.co/google/gemma-2-9b-it" target="_blank" rel="noopener">Gemma 2</a></li>
          </ul>
        </li>
        <li>
          <strong>Create Access Token</strong>: Go to <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a>
          <ul>
            <li>Click &quot;New token&quot;</li>
            <li>Select &quot;Read&quot; access</li>
            <li>Copy the token (starts with <code>hf_</code>)</li>
          </ul>
        </li>
        <li>
          <strong>Enter Token</strong>: Paste your token when deploying the model
        </li>
      </ol>

      <div className="not-prose bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 my-6">
        <h4 className="text-amber-800 dark:text-amber-200 font-semibold mb-2 text-base">Token Security</h4>
        <p className="text-amber-700 dark:text-amber-300 text-sm mb-0">
          Your HuggingFace token is only used during model download and is never stored permanently.
          It&apos;s transmitted securely and deleted after the model is loaded.
        </p>
      </div>

      <h2 id="using-your-model">Using Your Deployed Model</h2>
      <p>Once deployed, you&apos;ll receive an API endpoint like:</p>
      <pre><code>http://35.190.160.152:20000/v1</code></pre>

      <h3>cURL</h3>
      <pre>
        <code>{`curl http://YOUR-IP:PORT/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "meta-llama/Llama-3.1-8B-Instruct",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100
  }'`}</code>
      </pre>

      <h3>Python (OpenAI SDK)</h3>
      <pre>
        <code>{`from openai import OpenAI

client = OpenAI(
    base_url="http://YOUR-IP:PORT/v1",
    api_key="not-needed"  # No auth required for direct endpoint
)

response = client.chat.completions.create(
    model="meta-llama/Llama-3.1-8B-Instruct",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Write a haiku about GPUs"}
    ],
    max_tokens=100,
    temperature=0.7
)

print(response.choices[0].message.content)`}</code>
      </pre>

      <h3>Streaming Responses</h3>
      <pre>
        <code>{`stream = client.chat.completions.create(
    model="meta-llama/Llama-3.1-8B-Instruct",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
    max_tokens=500
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`}</code>
      </pre>

      <h3>JavaScript/TypeScript</h3>
      <pre>
        <code>{`import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://YOUR-IP:PORT/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  maxTokens: 100,
});

console.log(response.choices[0].message.content);`}</code>
      </pre>

      <h2 id="api-endpoints">API Endpoints</h2>
      <p>Your vLLM server exposes these endpoints:</p>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Method</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/v1/chat/completions</code></td>
            <td>POST</td>
            <td>Chat completions (recommended)</td>
          </tr>
          <tr>
            <td><code>/v1/completions</code></td>
            <td>POST</td>
            <td>Text completions (legacy)</td>
          </tr>
          <tr>
            <td><code>/v1/models</code></td>
            <td>GET</td>
            <td>List loaded models</td>
          </tr>
          <tr>
            <td><code>/health</code></td>
            <td>GET</td>
            <td>Health check</td>
          </tr>
          <tr>
            <td><code>/version</code></td>
            <td>GET</td>
            <td>vLLM version info</td>
          </tr>
        </tbody>
      </table>

      <h3>Deployment Status</h3>
      <p>Your deployment goes through these stages:</p>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Description</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Pending</strong></td>
            <td>GPU being provisioned</td>
            <td>~30 seconds</td>
          </tr>
          <tr>
            <td><strong>Deploying</strong></td>
            <td>Instance starting</td>
            <td>~1 minute</td>
          </tr>
          <tr>
            <td><strong>Installing</strong></td>
            <td>Dependencies being installed</td>
            <td>~2 minutes</td>
          </tr>
          <tr>
            <td><strong>Starting</strong></td>
            <td>vLLM starting, model downloading/loading</td>
            <td>2-10 minutes</td>
          </tr>
          <tr>
            <td><strong>Running</strong></td>
            <td>Ready to accept requests</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>

      <h2 id="gpu-sizing">GPU Sizing Guide</h2>
      <p>
        Model size determines GPU requirements. Use this guide to choose the right configuration:
      </p>
      <table>
        <thead>
          <tr>
            <th>Model Size</th>
            <th>GPU Memory Needed</th>
            <th>Recommended Config</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1-7B</td>
            <td>~16GB</td>
            <td>1x RTX 4090 (24GB)</td>
          </tr>
          <tr>
            <td>7-15B</td>
            <td>~20-32GB</td>
            <td>1-2x RTX 4090 or 1x A100 40GB</td>
          </tr>
          <tr>
            <td>30-34B</td>
            <td>~40-70GB</td>
            <td>2x A100 40GB or 4x RTX 4090</td>
          </tr>
          <tr>
            <td>65-70B</td>
            <td>~140GB</td>
            <td>4x A100 40GB or 8x RTX 4090</td>
          </tr>
          <tr>
            <td>70B+ Quantized</td>
            <td>~40-70GB</td>
            <td>2x A100 or 4x RTX 4090 with AWQ/GPTQ</td>
          </tr>
        </tbody>
      </table>

      <div className="not-prose bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 my-6">
        <h4 className="text-green-800 dark:text-green-200 font-semibold mb-2 text-base">Memory Calculation</h4>
        <p className="text-green-700 dark:text-green-300 text-sm mb-0">
          Rule of thumb: Each billion parameters needs ~2GB in FP16. A 7B model needs ~14GB, plus overhead
          for KV cache. Start with the minimum and scale up if you hit out-of-memory errors.
        </p>
      </div>

      <h2 id="monitoring">Monitoring</h2>

      <h3>View Deployment Logs</h3>
      <p>
        Click the <strong>Logs</strong> button on your deployment card to view
        real-time logs. You can also expand to full screen for detailed debugging.
      </p>

      <h3>Check Server Status</h3>
      <pre>
        <code>{`# Health check
curl http://YOUR-IP:PORT/health

# List loaded models
curl http://YOUR-IP:PORT/v1/models

# Check vLLM version
curl http://YOUR-IP:PORT/version`}</code>
      </pre>

      <h3>SSH Access for Debugging</h3>
      <p>For detailed debugging, SSH into your instance:</p>
      <pre>
        <code>{`# Connect to instance
ssh -p <port> ubuntu@<host>

# View vLLM logs
tail -f ~/hf-workspace/vllm.log

# Check GPU utilization
nvidia-smi

# Watch GPU in real-time
watch -n 1 nvidia-smi`}</code>
      </pre>

      <h2 id="persistent-storage">Using Persistent Storage</h2>
      <p>Enable persistent storage to:</p>
      <ul>
        <li><strong>Cache downloaded models</strong> - Faster restarts (minutes → seconds)</li>
        <li><strong>Save conversation logs</strong> - Keep inference logs</li>
        <li><strong>Store fine-tuned adapters</strong> - Use custom LoRA adapters</li>
      </ul>
      <p>
        With persistent storage, model downloads are cached and subsequent
        starts load directly from storage.
      </p>

      <h2 id="troubleshooting">Troubleshooting</h2>

      <h3>Model Not Loading</h3>
      <p>Check the deployment logs for errors. Common issues:</p>
      <table>
        <thead>
          <tr>
            <th>Error</th>
            <th>Cause</th>
            <th>Solution</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>CUDA out of memory</code></td>
            <td>Model too large for GPU(s)</td>
            <td>Use more GPUs or a smaller model</td>
          </tr>
          <tr>
            <td><code>401 Unauthorized</code></td>
            <td>Gated model, no token</td>
            <td>Accept terms and provide HF token</td>
          </tr>
          <tr>
            <td><code>Model not found</code></td>
            <td>Invalid model ID</td>
            <td>Check spelling on HuggingFace</td>
          </tr>
          <tr>
            <td><code>Connection timeout</code></td>
            <td>Still downloading</td>
            <td>Wait for model download to complete</td>
          </tr>
        </tbody>
      </table>

      <h3>API Not Responding</h3>
      <ol>
        <li>Check if deployment status is &quot;Running&quot;</li>
        <li>Verify the port is exposed (check the endpoint URL)</li>
        <li>Wait for model loading to complete (check logs)</li>
        <li>Try the health endpoint: <code>curl http://YOUR-IP:PORT/health</code></li>
      </ol>

      <h3>Slow Responses</h3>
      <ul>
        <li><strong>First request slow</strong>: Model loading into GPU memory, subsequent requests faster</li>
        <li><strong>Consistently slow</strong>: Check GPU utilization with <code>nvidia-smi</code></li>
        <li><strong>High latency</strong>: Consider a smaller model or more GPUs</li>
        <li><strong>Timeouts</strong>: Reduce <code>max_tokens</code> or add streaming</li>
      </ul>

      <h3>Out of Memory</h3>
      <ul>
        <li>Increase GPU count (Scale feature)</li>
        <li>Use a quantized model version (AWQ, GPTQ)</li>
        <li>Reduce <code>max_model_len</code> in vLLM config</li>
        <li>Try a smaller model variant</li>
      </ul>

      <h2>Need Help?</h2>
      <p>
        Reach out via the <strong>Support</strong> tab in your dashboard
      </p>
    </div>
  );
}
