"use client";

export function Pro6000BlackwellDoc() {
  return (
    <div className="prose prose-zinc prose-pre:overflow-x-auto prose-pre:max-w-full">
      <h1>Pro 6000 Blackwell Optimized Models</h1>
      <p className="lead">
        One-click deploy templates for NVIDIA RTX Pro 6000 Blackwell GPUs with 96GB VRAM.
        Run 70B+ parameter models at full performance.
      </p>

      <h2>Overview</h2>
      <p>
        The Pro 6000 Blackwell section features AI models specifically optimized for NVIDIA RTX
        Pro 6000 Blackwell GPUs with 96GB VRAM. These pre-configured templates enable one-click
        deployment of large language models, taking full advantage of the Blackwell architecture.
      </p>

      <h3>Key Features</h3>
      <ul>
        <li><strong>96GB VRAM Capacity</strong> - Run 70B+ parameter models</li>
        <li><strong>Blackwell Architecture</strong> - Latest NVIDIA GPU technology</li>
        <li><strong>vLLM Optimized</strong> - Pre-configured for maximum throughput</li>
        <li><strong>One-Click Deploy</strong> - Launch production-ready models instantly</li>
        <li><strong>AWQ/GPTQ Support</strong> - Quantized models for efficiency</li>
        <li><strong>FP8 Precision</strong> - Leverage Blackwell&apos;s native FP8 support</li>
      </ul>

      <h2>Hardware Specifications</h2>

      <h3>NVIDIA RTX Pro 6000 Blackwell</h3>
      <table>
        <thead>
          <tr>
            <th>Specification</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>GPU Memory</td>
            <td>96 GB GDDR7</td>
          </tr>
          <tr>
            <td>Memory Bandwidth</td>
            <td>1.8 TB/s</td>
          </tr>
          <tr>
            <td>CUDA Cores</td>
            <td>18,176</td>
          </tr>
          <tr>
            <td>Tensor Cores</td>
            <td>568 (5th gen)</td>
          </tr>
          <tr>
            <td>TDP</td>
            <td>350W</td>
          </tr>
          <tr>
            <td>FP8 Performance</td>
            <td>2,500+ TFLOPS</td>
          </tr>
          <tr>
            <td>FP16 Performance</td>
            <td>1,250+ TFLOPS</td>
          </tr>
        </tbody>
      </table>

      <h3>Model Size Guidelines</h3>
      <table>
        <thead>
          <tr>
            <th>Workload</th>
            <th>Fit</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>7B models (FP16)</td>
            <td>Excellent</td>
            <td>~14GB, room for long context</td>
          </tr>
          <tr>
            <td>13B models (FP16)</td>
            <td>Excellent</td>
            <td>~26GB, fast inference</td>
          </tr>
          <tr>
            <td>34B models (FP16)</td>
            <td>Good</td>
            <td>~42GB, fits with care</td>
          </tr>
          <tr>
            <td>70B models (AWQ/FP8)</td>
            <td>Good</td>
            <td>~35-45GB with quantization</td>
          </tr>
          <tr>
            <td>70B models (FP16)</td>
            <td>Marginal</td>
            <td>~140GB needed, use multi-GPU</td>
          </tr>
        </tbody>
      </table>

      <h2>Pre-Configured Models</h2>

      <h3>Llama 3.1 70B Instruct</h3>
      <ul>
        <li><strong>Model:</strong> meta-llama/Llama-3.1-70B-Instruct</li>
        <li><strong>VRAM Required:</strong> ~45GB (FP8)</li>
        <li><strong>Context Length:</strong> 128K tokens</li>
        <li><strong>Use Cases:</strong> General assistant, coding, analysis</li>
        <li><strong>Performance:</strong> ~50 tokens/sec</li>
      </ul>
      <pre>
        <code>{`python -m vllm.entrypoints.openai.api_server \\
  --model meta-llama/Llama-3.1-70B-Instruct \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --dtype float16 \\
  --max-model-len 32768 \\
  --gpu-memory-utilization 0.95`}</code>
      </pre>

      <h3>Qwen 2.5 72B Instruct</h3>
      <ul>
        <li><strong>Model:</strong> Qwen/Qwen2.5-72B-Instruct</li>
        <li><strong>VRAM Required:</strong> ~45GB (FP8)</li>
        <li><strong>Context Length:</strong> 128K tokens</li>
        <li><strong>Use Cases:</strong> Multilingual, reasoning, math</li>
        <li><strong>Performance:</strong> ~45 tokens/sec</li>
      </ul>
      <pre>
        <code>{`python -m vllm.entrypoints.openai.api_server \\
  --model Qwen/Qwen2.5-72B-Instruct \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --dtype bfloat16 \\
  --max-model-len 32768 \\
  --gpu-memory-utilization 0.95 \\
  --trust-remote-code`}</code>
      </pre>

      <h3>DeepSeek R1 Distill 32B</h3>
      <ul>
        <li><strong>Model:</strong> deepseek-ai/DeepSeek-R1-Distill-Qwen-32B</li>
        <li><strong>VRAM Required:</strong> ~38GB (FP16)</li>
        <li><strong>Context Length:</strong> 64K tokens</li>
        <li><strong>Use Cases:</strong> Reasoning, chain-of-thought, math</li>
        <li><strong>Performance:</strong> ~80 tokens/sec</li>
      </ul>
      <pre>
        <code>{`python -m vllm.entrypoints.openai.api_server \\
  --model deepseek-ai/DeepSeek-R1-Distill-Qwen-32B \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --dtype float16 \\
  --max-model-len 16384 \\
  --gpu-memory-utilization 0.90`}</code>
      </pre>

      <h3>Gemma 2 27B Instruct</h3>
      <ul>
        <li><strong>Model:</strong> google/gemma-2-27b-it</li>
        <li><strong>VRAM Required:</strong> ~35GB (FP16)</li>
        <li><strong>Context Length:</strong> 8K tokens</li>
        <li><strong>Use Cases:</strong> Fast inference, general tasks</li>
        <li><strong>Performance:</strong> ~90 tokens/sec</li>
      </ul>
      <pre>
        <code>{`python -m vllm.entrypoints.openai.api_server \\
  --model google/gemma-2-27b-it \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --dtype bfloat16 \\
  --max-model-len 8192 \\
  --gpu-memory-utilization 0.90`}</code>
      </pre>

      <h3>Llama 3.1 70B AWQ (Quantized)</h3>
      <ul>
        <li><strong>Model:</strong> hugging-quants/Meta-Llama-3.1-70B-Instruct-AWQ-INT4</li>
        <li><strong>VRAM Required:</strong> ~38GB</li>
        <li><strong>Context Length:</strong> 128K tokens</li>
        <li><strong>Performance:</strong> ~65 tokens/sec (faster than FP16!)</li>
      </ul>
      <pre>
        <code>{`python -m vllm.entrypoints.openai.api_server \\
  --model hugging-quants/Meta-Llama-3.1-70B-Instruct-AWQ-INT4 \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --quantization awq \\
  --max-model-len 32768 \\
  --gpu-memory-utilization 0.95`}</code>
      </pre>

      <h2>Model Comparison</h2>

      <h3>Performance vs VRAM</h3>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>VRAM</th>
            <th>Tokens/sec</th>
            <th>Context</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Llama 3.1 70B FP8</td>
            <td>45GB</td>
            <td>~50</td>
            <td>128K</td>
          </tr>
          <tr>
            <td>Llama 3.1 70B AWQ</td>
            <td>38GB</td>
            <td>~65</td>
            <td>128K</td>
          </tr>
          <tr>
            <td>Qwen 2.5 72B FP8</td>
            <td>45GB</td>
            <td>~45</td>
            <td>128K</td>
          </tr>
          <tr>
            <td>DeepSeek R1 32B</td>
            <td>38GB</td>
            <td>~80</td>
            <td>64K</td>
          </tr>
          <tr>
            <td>Gemma 2 27B</td>
            <td>35GB</td>
            <td>~90</td>
            <td>8K</td>
          </tr>
        </tbody>
      </table>

      <h3>Recommended by Use Case</h3>
      <table>
        <thead>
          <tr>
            <th>Use Case</th>
            <th>Recommended Model</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>General Assistant</td>
            <td>Llama 3.1 70B</td>
            <td>Best all-around quality</td>
          </tr>
          <tr>
            <td>Coding</td>
            <td>DeepSeek R1 32B</td>
            <td>Specialized training</td>
          </tr>
          <tr>
            <td>Multilingual</td>
            <td>Qwen 2.5 72B</td>
            <td>Excellent non-English</td>
          </tr>
          <tr>
            <td>Fast Inference</td>
            <td>Gemma 2 27B</td>
            <td>Highest throughput</td>
          </tr>
          <tr>
            <td>Long Context</td>
            <td>Qwen 2.5 72B AWQ</td>
            <td>128K with efficiency</td>
          </tr>
          <tr>
            <td>Math/Reasoning</td>
            <td>DeepSeek R1 32B</td>
            <td>Chain-of-thought</td>
          </tr>
        </tbody>
      </table>

      <h2>Optimal vLLM Settings</h2>
      <pre>
        <code>{`python -m vllm.entrypoints.openai.api_server \\
  --model YOUR_MODEL_HERE \\
  --host 0.0.0.0 \\
  --port 8000 \\
  --dtype bfloat16 \\
  --max-model-len 32768 \\
  --gpu-memory-utilization 0.92 \\
  --enforce-eager \\
  --enable-chunked-prefill \\
  --max-num-seqs 32 \\
  --api-key YOUR_API_KEY`}</code>
      </pre>

      <h3>Memory Optimization Tips</h3>
      <ol>
        <li><strong>Reduce max-model-len</strong> if you don&apos;t need long context</li>
        <li><strong>Use quantized models</strong> (AWQ preferred over GPTQ)</li>
        <li><strong>Lower max-num-seqs</strong> for less KV cache usage</li>
        <li><strong>Set gpu-memory-utilization to 0.90-0.95</strong></li>
      </ol>

      <h2>Troubleshooting</h2>

      <h3>Out of Memory (OOM)</h3>
      <p><strong>Symptoms:</strong> CUDA OOM error during model loading or inference</p>
      <p><strong>Solutions:</strong></p>
      <ol>
        <li>Use quantized model (AWQ/GPTQ)</li>
        <li>Reduce <code>--max-model-len</code></li>
        <li>Lower <code>--max-num-seqs</code></li>
        <li>Set <code>--gpu-memory-utilization 0.85</code></li>
        <li>Use <code>--enforce-eager</code> to disable CUDA graphs</li>
      </ol>

      <h3>Slow Loading</h3>
      <p><strong>Symptoms:</strong> Model takes &gt;5 minutes to load</p>
      <p><strong>Solutions:</strong></p>
      <ol>
        <li>Use <code>--load-format auto</code> or <code>safetensors</code></li>
        <li>Pre-download model: <code>huggingface-cli download MODEL_ID</code></li>
        <li>Use local SSD storage for model weights</li>
        <li>Enable persistent storage for caching</li>
      </ol>

      <h3>Low Throughput</h3>
      <p><strong>Symptoms:</strong> Tokens/sec lower than expected</p>
      <p><strong>Solutions:</strong></p>
      <ol>
        <li>Enable <code>--enable-chunked-prefill</code></li>
        <li>Increase <code>--max-num-seqs</code> for batching</li>
        <li>Use AWQ quantization (faster than FP16!)</li>
        <li>Check for thermal throttling in GPU metrics</li>
      </ol>

      <h2>Performance Benchmarks</h2>

      <h3>Tested on Pro 6000 Blackwell (96GB)</h3>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Batch 1</th>
            <th>Batch 8</th>
            <th>Batch 32</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Llama 3.1 70B AWQ</td>
            <td>42 t/s</td>
            <td>180 t/s</td>
            <td>450 t/s</td>
          </tr>
          <tr>
            <td>Qwen 2.5 72B GPTQ</td>
            <td>38 t/s</td>
            <td>160 t/s</td>
            <td>400 t/s</td>
          </tr>
          <tr>
            <td>DeepSeek R1 32B</td>
            <td>65 t/s</td>
            <td>280 t/s</td>
            <td>680 t/s</td>
          </tr>
          <tr>
            <td>Gemma 2 27B</td>
            <td>78 t/s</td>
            <td>340 t/s</td>
            <td>820 t/s</td>
          </tr>
        </tbody>
      </table>
      <p><em>t/s = tokens per second, output tokens only</em></p>

      <h2>Security Recommendations</h2>

      <h3>API Authentication</h3>
      <p>Always enable API key authentication in production:</p>
      <pre>
        <code>{`# Generate secure key
API_KEY=$(openssl rand -hex 32)

# Start with auth
python -m vllm.entrypoints.openai.api_server \\
  --model YOUR_MODEL \\
  --api-key $API_KEY`}</code>
      </pre>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        <a href="mailto:support@example.com">support@example.com</a>
      </p>
    </div>
  );
}
