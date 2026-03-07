"use client";

export function GPUMetricsDoc() {
  return (
    <div className="prose prose-zinc prose-pre:overflow-x-auto prose-pre:max-w-full">
      <h1>GPU Metrics Dashboard</h1>
      <p className="lead">
        Real-time GPU monitoring and analytics for optimal performance tracking.
      </p>

      <h2>Overview</h2>
      <p>
        The GPU Metrics Dashboard provides comprehensive monitoring of your GPU instances.
        Track utilization, memory usage, temperature, and inference performance in real-time
        to optimize your AI workloads.
      </p>

      <h3>Key Features</h3>
      <ul>
        <li><strong>Real-time Monitoring</strong> - Live updates every 5 seconds</li>
        <li><strong>GPU Utilization</strong> - Track compute usage percentage</li>
        <li><strong>Memory Tracking</strong> - Monitor VRAM allocation and usage</li>
        <li><strong>Temperature Monitoring</strong> - Watch GPU thermals</li>
        <li><strong>Inference Metrics</strong> - Tokens/sec, queue depth, latency</li>
        <li><strong>Historical Data</strong> - View trends over time</li>
      </ul>

      <h2>Dashboard Sections</h2>

      <h3>GPU Overview Cards</h3>
      <p>Quick summary at the top showing:</p>
      <ul>
        <li><strong>GPU Utilization</strong> - Current compute usage (%)</li>
        <li><strong>Memory Usage</strong> - VRAM used / total (e.g., 42GB / 96GB)</li>
        <li><strong>Temperature</strong> - Current GPU temperature</li>
        <li><strong>Power Draw</strong> - Current power consumption (W)</li>
      </ul>

      <h3>Utilization Chart</h3>
      <p>Time-series graph showing GPU usage over time:</p>
      <ul>
        <li>Compute utilization percentage</li>
        <li>Memory utilization percentage</li>
        <li>Hover for exact values at any point</li>
        <li>Zoom and pan for detailed analysis</li>
      </ul>

      <h3>Memory Breakdown</h3>
      <p>Detailed VRAM allocation:</p>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Model Weights</td>
            <td>Memory used by model parameters</td>
          </tr>
          <tr>
            <td>KV Cache</td>
            <td>Memory for attention key-value cache</td>
          </tr>
          <tr>
            <td>Activation Memory</td>
            <td>Memory for intermediate computations</td>
          </tr>
          <tr>
            <td>System Reserved</td>
            <td>CUDA and driver overhead</td>
          </tr>
        </tbody>
      </table>

      <h3>Inference Metrics</h3>
      <p>Performance statistics for your model:</p>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Description</th>
            <th>Typical Range</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tokens/sec</td>
            <td>Output generation speed</td>
            <td>30-150 t/s</td>
          </tr>
          <tr>
            <td>TTFT</td>
            <td>Time to first token</td>
            <td>20-200 ms</td>
          </tr>
          <tr>
            <td>Queue Depth</td>
            <td>Pending requests</td>
            <td>0-32</td>
          </tr>
          <tr>
            <td>Active Requests</td>
            <td>Currently processing</td>
            <td>1-64</td>
          </tr>
          <tr>
            <td>Batch Size</td>
            <td>Current batch size</td>
            <td>1-128</td>
          </tr>
        </tbody>
      </table>

      <h2>Understanding Metrics</h2>

      <h3>GPU Utilization</h3>
      <p>Percentage of GPU compute being used:</p>
      <ul>
        <li><strong>0-20%</strong> - Underutilized, consider smaller instance</li>
        <li><strong>20-60%</strong> - Light load, room for more requests</li>
        <li><strong>60-85%</strong> - Healthy utilization</li>
        <li><strong>85-100%</strong> - Heavy load, may need more capacity</li>
      </ul>

      <h3>Memory Usage</h3>
      <p>VRAM consumption guidelines:</p>
      <ul>
        <li><strong>Model weights</strong> - Fixed based on model size</li>
        <li><strong>KV cache</strong> - Grows with context length and batch size</li>
        <li><strong>Headroom</strong> - Keep 5-10% free for safety</li>
      </ul>

      <h3>Temperature</h3>
      <p>GPU thermal status:</p>
      <ul>
        <li><strong>&lt;70°C</strong> - Cool, excellent</li>
        <li><strong>70-80°C</strong> - Normal operating range</li>
        <li><strong>80-85°C</strong> - Warm but safe</li>
        <li><strong>&gt;85°C</strong> - Hot, may throttle</li>
      </ul>

      <h2>Time Range Selection</h2>
      <p>View metrics over different periods:</p>
      <ul>
        <li><strong>Live</strong> - Real-time streaming (5s intervals)</li>
        <li><strong>1 Hour</strong> - Recent performance</li>
        <li><strong>24 Hours</strong> - Daily patterns</li>
        <li><strong>7 Days</strong> - Weekly trends</li>
        <li><strong>Custom</strong> - Select specific date range</li>
      </ul>

      <h2>Performance Optimization</h2>

      <h3>Improve Throughput</h3>
      <ul>
        <li>Increase <code>max-num-seqs</code> for more concurrent requests</li>
        <li>Enable <code>--enable-chunked-prefill</code> for better batching</li>
        <li>Use quantized models (AWQ/GPTQ) for higher throughput</li>
        <li>Reduce <code>max-model-len</code> if long context not needed</li>
      </ul>

      <h3>Reduce Latency</h3>
      <ul>
        <li>Use smaller models for faster responses</li>
        <li>Enable <code>--enforce-eager</code> for more predictable latency</li>
        <li>Decrease batch size for lower individual request latency</li>
        <li>Pre-warm the model with a few requests after startup</li>
      </ul>

      <h3>Memory Optimization</h3>
      <ul>
        <li>Lower <code>gpu-memory-utilization</code> if seeing OOM errors</li>
        <li>Reduce <code>max-model-len</code> to free KV cache memory</li>
        <li>Use quantized models to reduce memory footprint</li>
        <li>Decrease <code>max-num-seqs</code> for less KV cache usage</li>
      </ul>

      <h2>Alerting</h2>
      <p>Set up alerts for important thresholds:</p>
      <table>
        <thead>
          <tr>
            <th>Alert Type</th>
            <th>Threshold</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>High Temperature</td>
            <td>&gt;85°C</td>
            <td>Check cooling, reduce load</td>
          </tr>
          <tr>
            <td>Memory Full</td>
            <td>&gt;95%</td>
            <td>Reduce batch size or context</td>
          </tr>
          <tr>
            <td>Low Utilization</td>
            <td>&lt;10%</td>
            <td>Consider smaller instance</td>
          </tr>
          <tr>
            <td>High Queue Depth</td>
            <td>&gt;50</td>
            <td>Add capacity or optimize</td>
          </tr>
        </tbody>
      </table>

      <h2>CLI Monitoring</h2>
      <p>SSH into your instance for detailed monitoring:</p>

      <h3>nvidia-smi</h3>
      <pre>
        <code>{`# One-time snapshot
nvidia-smi

# Continuous monitoring (every 1 second)
nvidia-smi -l 1

# GPU utilization only
nvidia-smi --query-gpu=utilization.gpu --format=csv`}</code>
      </pre>

      <h3>nvtop</h3>
      <pre>
        <code>{`# Interactive GPU monitor (like htop for GPUs)
nvtop`}</code>
      </pre>

      <h3>vLLM Metrics</h3>
      <pre>
        <code>{`# Check vLLM logs for performance
tail -f ~/hf-workspace/vllm.log | grep "tokens/s"`}</code>
      </pre>

      <h2>Prometheus Integration</h2>
      <p>Export metrics to Prometheus for advanced monitoring:</p>
      <pre>
        <code>{`# vLLM exposes metrics at /metrics
curl http://YOUR-IP:PORT/metrics

# Example metrics:
vllm:num_requests_running
vllm:num_requests_waiting
vllm:gpu_cache_usage_perc
vllm:avg_generation_throughput_toks_per_s`}</code>
      </pre>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        <a href="mailto:support@example.com">support@example.com</a>
      </p>
    </div>
  );
}
