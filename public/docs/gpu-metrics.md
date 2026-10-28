# GPU Metrics Dashboard

## Overview

The Metrics dashboard provides monitoring and visualization of your GPU instances running AI workloads. Track compute usage, memory usage, and inference performance metrics to optimize your deployments and troubleshoot issues.

### Key Features

- **Compute & VRAM Tracking**: Account-wide TFLOPs and GPU memory usage from platform telemetry
- **Automatic Refresh**: The Metrics tab updates every 60 seconds
- **Per-Pod Breakdown**: See TFLOPs and VRAM usage for each individual pod
- **Historical Data**: View trends from the last 5 minutes up to all time
- **vLLM Integration**: Inference-specific metrics (tokens/sec, cache usage, queue depth) for deployed models
- **Automatic Storage Alerts**: Email warnings when pod storage approaches capacity

---

## 🚀 Quick Start

### Accessing GPU Metrics

1. Navigate to your Packet.ai Dashboard
2. Click **Metrics** in the sidebar
3. Choose a time period: **5 Min**, **1 Hour**, **24 Hours**, **Week**, or **All Time**

### Understanding the Dashboard

The Metrics tab displays:
- **Compute**: Average TFLOPs consumed over the selected window
- **VRAM**: Average GPU memory used (GB)
- **Active Pods**: Number of pods currently running
- **Usage Over Time**: Chart of TFLOPs and VRAM across the selected window
- **Pod Metrics**: Per-pod table with status, TFLOPs, and VRAM

Values are sourced from platform telemetry, averaged over the selected window, and refresh every minute.

In addition, each running pod reports hardware metrics (GPU utilization, VRAM, temperature, power draw, fan speed, CPU, system memory, and disk usage) every 60 seconds in the background. These power storage alerts and the metrics history API described below. On shared GPUs, utilization and VRAM-used figures reflect your pod's own processes, while temperature and power reflect the underlying physical GPU.

---

## 📊 Core Metrics

### GPU Utilization

**What it measures**: The percentage of GPU compute units actively processing.

| Utilization | Meaning | Action |
|-------------|---------|--------|
| **0-20%** | Idle or light load | Consider smaller GPU or more workloads |
| **20-60%** | Moderate use | Normal for variable workloads |
| **60-90%** | Good utilization | Optimal for most inference |
| **90-100%** | Heavy load | Monitor for throttling |

The Metrics tab expresses compute as **TFLOPs**; per-pod GPU utilization percentages are collected in the background and available through the metrics history API.

### Memory Usage (VRAM)

**What it measures**: Video RAM consumed by models and KV cache.

| GPU | Total VRAM | Model Fit |
|-----|-----------|-----------|
| RTX Pro 6000 Blackwell | 96 GB | Up to 70B+ models |
| H100 | 80 GB | Up to 180B models |
| A100 | 40/80 GB | 30-180B models |
| L40S | 48 GB | Up to 70B models |

**Memory Breakdown**:
- **Model Weights**: The neural network parameters
- **KV Cache**: Attention cache for context
- **Overhead**: CUDA runtime, buffers

### Temperature

**What it measures**: GPU core temperature in Celsius. Collected in the background and available through the metrics history API.

| Temperature | Status | Action |
|-------------|--------|--------|
| **< 50°C** | Cool | Normal idle |
| **50-70°C** | Warm | Normal under load |
| **70-83°C** | Hot | Heavy load, monitor |
| **> 83°C** | Thermal limit | Throttling may occur |

### Power Consumption

**What it measures**: Current power draw in watts, versus the GPU's configured power limit. Collected in the background and available through the metrics history API.

| GPU | TDP | Typical Inference |
|-----|-----|-------------------|
| RTX Pro 6000 Blackwell | 350W | 200-300W |
| H100 | 700W | 400-600W |
| A100 | 400W | 250-350W |
| L40S | 350W | 200-300W |

---

## 📈 Inference Metrics

When a vLLM-based model is running on your pod (for example a Hugging Face deployment) **and port 8000 is exposed as a service**, a **GPU Metrics** panel appears on the instance card showing:

- **Health status** and the loaded **model ID**
- **GPU Cache** (KV cache) usage percentage
- **Gen Throughput** and **Prompt Throughput** (tokens/sec)
- **Time to First Token** (ms)
- **Running** and **Waiting** request counts
- **Total Tokens** (prompt + generation)

The panel refreshes every 10 seconds while visible.

### Tokens Per Second

**What it measures**: Generation throughput.

| Tokens/sec | Quality |
|------------|---------|
| **< 20** | Slow (may be loading) |
| **20-50** | Acceptable |
| **50-100** | Good |
| **100+** | Excellent |

**Factors affecting throughput**:
- Model size
- Batch size
- Sequence length
- Quantization (AWQ/GPTQ vs FP16)

### Request Queue

**What it measures**: Pending inference requests (the **Waiting** count).

| Queue Size | Meaning |
|------------|---------|
| **0** | No backlog, instant responses |
| **1-5** | Light load, minimal wait |
| **5-20** | Moderate load |
| **20+** | Heavy load, consider scaling |

### KV Cache Utilization

**What it measures**: Attention cache usage for concurrent contexts (the **GPU Cache** percentage).

**When KV cache is full**:
- New requests wait in queue
- Consider `--max-num-seqs` adjustment
- Or reduce `--max-model-len`

---

## 🔄 Real-Time Updates

### Refresh Interval

The dashboard updates automatically:
- **Metrics tab**: Every 60 seconds
- **Inference GPU Metrics panel**: Every 10 seconds while visible
- **Background hardware collection**: Every 60 seconds per pod

The refresh interval is not configurable; use the time period selector to change the window of data shown.

---

## 📉 Historical Data

### Time Ranges

View historical metrics in the Metrics tab for:
- **5 Min**: Most recent activity
- **1 Hour**: Fine-grained recent trend
- **24 Hours**: Daily overview
- **Week**: Last 7 days
- **All Time**: Full available history

Background hardware metrics (utilization, temperature, power, etc.) are retained for **7 days**; older records are automatically removed.

### Charts

The **Usage Over Time** chart shows:
- Compute (TFLOPs) over time
- VRAM usage over time

### Data Export

Historical hardware metrics can be retrieved as JSON via the metrics history API (see the API Reference section below). CSV export is not currently available.

---

## ⚠️ Alerts & Thresholds

### Storage Alerts

The platform automatically emails you when pod storage approaches capacity:

| Storage | Threshold | Behaviour |
|---------|-----------|-----------|
| Persistent storage (`/workspace`) | ≥ 80% | One email per pod |
| Root disk (`/`) | ≥ 80% | One email per pod |
| Root disk (`/`) | ≥ 90% | One additional email per pod |

Alerts are sent to your account email address. No configuration is required, and thresholds are fixed. A full root disk can cause your pod to be evicted, so act on these alerts promptly by freeing space or moving data to persistent storage.

Configurable per-metric alerts (for example on GPU utilization or temperature) are not currently available.

---

## 🔧 Prometheus Integration

### Metrics Endpoint

vLLM exposes Prometheus metrics on its API port. Once port 8000 is exposed as a service on your pod, you can scrape them directly:

```bash
curl http://YOUR_EXPOSED_HOST:YOUR_EXPOSED_PORT/metrics
```

### Key Prometheus Metrics

The dashboard's inference panel is built from these vLLM metrics:

```prometheus
# Cache metrics
vllm:gpu_cache_usage_perc
vllm:cpu_cache_usage_perc

# Request queue
vllm:num_requests_running
vllm:num_requests_waiting
vllm:num_requests_swapped

# Token counters
vllm:prompt_tokens_total
vllm:generation_tokens_total

# Throughput
vllm:avg_prompt_throughput_toks_per_s
vllm:avg_generation_throughput_toks_per_s

# Latency
vllm:time_to_first_token_seconds
```

You can also point your own Prometheus or Grafana instance at the exposed `/metrics` endpoint to build custom dashboards.

---

## 🔍 Troubleshooting

### High GPU Utilization (>95%)

**Symptoms**: Slow responses, queue backlog

**Solutions**:
1. Scale horizontally (more GPUs)
2. Use quantized models (AWQ)
3. Reduce `--max-model-len`
4. Implement request throttling

### Out of Memory (OOM)

**Symptoms**: Server crashes, CUDA OOM errors

**Solutions**:
1. Lower `--gpu-memory-utilization` (e.g., 0.85)
2. Use smaller model or quantization
3. Reduce `--max-num-seqs`
4. Clear cache: restart vLLM

### High Temperature

**Symptoms**: Thermal throttling, reduced performance

**Solutions**:
1. Check datacenter cooling
2. Reduce workload intensity
3. Verify GPU fan operation
4. Consider time-based load balancing

### Low Throughput

**Symptoms**: Low tokens/sec despite low utilization

**Solutions**:
1. Increase batch size
2. Enable continuous batching
3. Use tensor parallelism
4. Check for network bottlenecks

---

## 📚 API Reference

All endpoints require your Packet.ai session token in the `Authorization` header (the same Bearer token the dashboard uses):

```
Authorization: Bearer YOUR_SESSION_TOKEN
```

### Get Current Metrics

Compute and VRAM telemetry — account-wide, or for a single pod with `pod_id`:

```bash
GET /api/instances/gpu-metrics?window=last_1h
GET /api/instances/gpu-metrics?window=last_1h&pod_id=POD_ID
```

`window` values: `last_5m`, `last_15m`, `last_1h`, `last_24h`, `last_7d`, `all_time`.

**Response**:
```json
{
  "window": "last_1h",
  "data": [
    {
      "unix_timestamp": 1753856400,
      "formatted_time": "10:20",
      "tflops": 12.4,
      "vram_mib": 43520
    }
  ]
}
```

### Get Inference (vLLM) Metrics

Live inference metrics for one instance. Requires a running vLLM server with port 8000 exposed as a service (returns 404 otherwise):

```bash
GET /api/instances/{subscription_id}/gpu-metrics
```

**Response**:
```json
{
  "subscriptionId": "SUBSCRIPTION_ID",
  "metrics": {
    "gpuCacheUsagePercent": 85.0,
    "cpuCacheUsagePercent": 12.0,
    "numRequestsRunning": 5,
    "numRequestsWaiting": 2,
    "numRequestsSwapped": 0,
    "promptTokensTotal": 654321,
    "generationTokensTotal": 1234567,
    "avgPromptThroughput": 120.5,
    "avgGenerationThroughput": 87.3,
    "avgTimeToFirstToken": 250,
    "modelId": "meta-llama/Llama-3.3-70B-Instruct",
    "isHealthy": true
  },
  "timestamp": "2026-07-30T10:30:00Z"
}
```

### Get Historical Metrics

Time-series hardware metrics (utilization, memory, temperature, power, CPU, system memory) with summary statistics:

```bash
GET /api/instances/metrics-history?subscriptionId=SUBSCRIPTION_ID&hours=24&interval=5
```

Query parameters:
- `subscriptionId` (optional): Filter to one subscription; omit for all
- `hours` (optional): Look-back window in hours (default 24, max 168 = 7 days)
- `interval` (optional): Aggregation bucket size in minutes; omit for raw data points

**Response**:
```json
{
  "timeRange": { "start": "2026-07-29T10:30:00Z", "end": "2026-07-30T10:30:00Z", "hours": 24 },
  "subscriptions": [
    {
      "subscriptionId": "SUBSCRIPTION_ID",
      "data": [
        {
          "timestamp": "2026-07-30T10:25:00Z",
          "gpuUtilization": 78.5,
          "memoryPercent": 88.5,
          "temperature": 72,
          "powerDraw": 285,
          "cpuPercent": 34.2,
          "systemMemPercent": 51.0
        }
      ],
      "summary": {
        "avgGpuUtilization": 65.2,
        "avgMemoryPercent": 80.1,
        "avgTemperature": 68.4,
        "maxTemperature": 79,
        "avgPowerDraw": 260.3,
        "maxPowerDraw": 310.5,
        "avgCpuPercent": 30.1,
        "avgSystemMemPercent": 48.7,
        "dataPoints": 288
      }
    }
  ],
  "totalDataPoints": 288
}
```

---

## 📚 Related Documentation

- [Token Usage Dashboard](./token-usage.md)
- [Pro 6000 Blackwell Templates](./pro-6000-blackwell.md)
- [vLLM Multi-GPU Scaling](./vllm-multi-gpu-scaling.md)

---

**Last Updated**: July 2026 | **Version**: 1.1
