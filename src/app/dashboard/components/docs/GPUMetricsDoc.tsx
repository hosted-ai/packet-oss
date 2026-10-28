"use client";

export function GPUMetricsDoc() {
  return (
    <div>
      <p className="lead">
        GPU monitoring and analytics for your instances and AI workloads.
      </p>

      <h2>Overview</h2>
      <p>
        The Metrics dashboard provides monitoring and visualization of your GPU instances.
        Track compute usage, memory usage, and inference performance metrics to optimize
        your deployments and troubleshoot issues.
      </p>

      <h3>Key Features</h3>
      <ul>
        <li><strong>Compute & VRAM Tracking</strong> - Account-wide TFLOPs and GPU memory usage</li>
        <li><strong>Automatic Refresh</strong> - The Metrics tab updates every 60 seconds</li>
        <li><strong>Per-Pod Breakdown</strong> - TFLOPs and VRAM usage for each individual pod</li>
        <li><strong>Historical Data</strong> - View trends from the last 5 minutes up to all time</li>
        <li><strong>Inference Metrics</strong> - Tokens/sec, cache usage, queue depth for deployed models</li>
        <li><strong>Automatic Storage Alerts</strong> - Email warnings when pod storage approaches capacity</li>
      </ul>

      <h2>Dashboard Sections</h2>

      <h3>Overview Cards</h3>
      <p>Quick summary at the top showing:</p>
      <ul>
        <li><strong>Compute</strong> - Average TFLOPs consumed over the selected window</li>
        <li><strong>VRAM</strong> - Average GPU memory used (GB)</li>
        <li><strong>Active Pods</strong> - Number of pods currently running</li>
      </ul>

      <h3>Usage Over Time Chart</h3>
      <p>Time-series graph showing GPU usage over time:</p>
      <ul>
        <li>Compute (TFLOPs) over time</li>
        <li>VRAM usage over time</li>
        <li>Hover for exact values at any point</li>
      </ul>

      <h3>Pod Metrics</h3>
      <p>Per-pod table showing status, TFLOPs, and VRAM for each of your pods.</p>

      <h3>Inference Metrics</h3>
      <p>
        When a vLLM-based model is running on your pod and port 8000 is exposed as a
        service, a <strong>GPU Metrics</strong> panel appears on the instance card showing:
      </p>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Health & Model ID</td>
            <td>Server health status and the loaded model</td>
          </tr>
          <tr>
            <td>GPU Cache</td>
            <td>KV cache usage percentage</td>
          </tr>
          <tr>
            <td>Gen / Prompt Throughput</td>
            <td>Generation and prompt processing speed (tokens/sec)</td>
          </tr>
          <tr>
            <td>Time to First Token</td>
            <td>Latency before generation starts (ms)</td>
          </tr>
          <tr>
            <td>Running / Waiting</td>
            <td>Active and queued request counts</td>
          </tr>
          <tr>
            <td>Total Tokens</td>
            <td>Prompt + generation tokens processed</td>
          </tr>
        </tbody>
      </table>
      <p>The panel refreshes every 10 seconds while visible.</p>

      <h2>Understanding Metrics</h2>

      <h3>GPU Utilization</h3>
      <p>Percentage of GPU compute being used:</p>
      <ul>
        <li><strong>0-20%</strong> - Idle or light load, consider a smaller GPU</li>
        <li><strong>20-60%</strong> - Moderate use, normal for variable workloads</li>
        <li><strong>60-90%</strong> - Good utilization, optimal for most inference</li>
        <li><strong>90-100%</strong> - Heavy load, monitor for throttling</li>
      </ul>
      <p>
        The Metrics tab expresses compute as TFLOPs; per-pod GPU utilization percentages
        are collected in the background and available through the metrics history API.
      </p>

      <h3>Memory Usage</h3>
      <p>VRAM consumption guidelines:</p>
      <ul>
        <li><strong>Model weights</strong> - Fixed based on model size</li>
        <li><strong>KV cache</strong> - Grows with context length and batch size</li>
        <li><strong>Headroom</strong> - Keep 5-10% free for safety</li>
      </ul>

      <h3>Temperature</h3>
      <p>
        GPU core temperature, collected in the background and available through the
        metrics history API:
      </p>
      <ul>
        <li><strong>&lt;50°C</strong> - Cool, normal idle</li>
        <li><strong>50-70°C</strong> - Warm, normal under load</li>
        <li><strong>70-83°C</strong> - Hot, heavy load - monitor</li>
        <li><strong>&gt;83°C</strong> - Thermal limit, throttling may occur</li>
      </ul>

      <h2>Time Range Selection</h2>
      <p>View metrics over different periods:</p>
      <ul>
        <li><strong>5 Min</strong> - Most recent activity</li>
        <li><strong>1 Hour</strong> - Recent performance</li>
        <li><strong>24 Hours</strong> - Daily patterns</li>
        <li><strong>Week</strong> - Weekly trends</li>
        <li><strong>All Time</strong> - Full available history</li>
      </ul>
      <p>
        The Metrics tab refreshes automatically every 60 seconds; the refresh interval is
        not configurable.
      </p>

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
      <p>The platform automatically emails you when pod storage approaches capacity:</p>
      <table>
        <thead>
          <tr>
            <th>Storage</th>
            <th>Threshold</th>
            <th>Behaviour</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Persistent storage (<code>/workspace</code>)</td>
            <td>&ge;80%</td>
            <td>One email per pod</td>
          </tr>
          <tr>
            <td>Root disk (<code>/</code>)</td>
            <td>&ge;80%</td>
            <td>One email per pod</td>
          </tr>
          <tr>
            <td>Root disk (<code>/</code>)</td>
            <td>&ge;90%</td>
            <td>One additional email per pod</td>
          </tr>
        </tbody>
      </table>
      <p>
        Alerts are sent to your account email address; thresholds are fixed and no
        configuration is required. A full root disk can cause your pod to be evicted, so
        act on these alerts promptly. Configurable per-metric alerts (for example on GPU
        utilization or temperature) are not currently available.
      </p>

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
      <p>
        vLLM exposes Prometheus metrics on its API port. Once port 8000 is exposed as a
        service on your pod, you can scrape them directly:
      </p>
      <pre>
        <code>{`# vLLM exposes metrics at /metrics
curl http://YOUR_EXPOSED_HOST:YOUR_EXPOSED_PORT/metrics

# Example metrics:
vllm:num_requests_running
vllm:num_requests_waiting
vllm:gpu_cache_usage_perc
vllm:avg_generation_throughput_toks_per_s`}</code>
      </pre>
      <p>
        You can also point your own Prometheus or Grafana instance at the exposed{" "}
        <code>/metrics</code> endpoint to build custom dashboards.
      </p>

      <h2>Need Help?</h2>
      <p>
        Contact our support team via the <strong>Support</strong> tab.
      </p>
    </div>
  );
}
