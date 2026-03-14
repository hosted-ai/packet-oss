# GPU Metrics Dashboard

## Overview

The GPU Metrics Dashboard provides real-time monitoring and visualization of your GPU instances running AI workloads. Track utilization, memory usage, temperature, and inference performance metrics to optimize your deployments and troubleshoot issues.

### Key Features

- **Real-time Monitoring**: Live updates every 5 seconds
- **Historical Data**: View trends over hours, days, or weeks
- **Multi-GPU Support**: Monitor individual GPUs and aggregate metrics
- **Alert Thresholds**: Set warnings for high utilization or temperature
- **vLLM Integration**: Inference-specific metrics (tokens/sec, cache usage)
- **Export Data**: Download metrics as CSV or JSON

---

## 🚀 Quick Start

### Accessing GPU Metrics

1. Navigate to your Packet.ai Dashboard
2. Select a GPU instance
3. Click the **"Metrics"** or **"Monitoring"** tab
4. View real-time GPU statistics

### Understanding the Dashboard

The dashboard displays:
- **GPU Utilization**: Percentage of compute capacity in use
- **Memory Usage**: VRAM consumption vs. total available
- **Temperature**: Current GPU temperature
- **Power Draw**: Watts consumed vs. TDP limit
- **Inference Metrics**: Requests/sec, tokens/sec (when vLLM is running)

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

**Dashboard Display**:
```
GPU Utilization: 78% ████████░░
```

### Memory Usage (VRAM)

**What it measures**: Video RAM consumed by models and KV cache.

| GPU | Total VRAM | Model Fit |
|-----|-----------|-----------|
| RTX Pro 6000 Blackwell | 48 GB | Up to 70B models |
| H100 | 80 GB | Up to 180B models |
| A100 | 40/80 GB | 30-180B models |
| L40S | 48 GB | Up to 70B models |

**Dashboard Display**:
```
Memory: 42.5 GB / 48 GB (88.5%)
████████████████████░░
```

**Memory Breakdown**:
- **Model Weights**: The neural network parameters
- **KV Cache**: Attention cache for context
- **Overhead**: CUDA runtime, buffers

### Temperature

**What it measures**: GPU core temperature in Celsius.

| Temperature | Status | Action |
|-------------|--------|--------|
| **< 50°C** | Cool | Normal idle |
| **50-70°C** | Warm | Normal under load |
| **70-83°C** | Hot | Heavy load, monitor |
| **> 83°C** | Thermal limit | Throttling may occur |

**Dashboard Display**:
```
Temperature: 72°C 🌡️
[Safe Range: < 83°C]
```

### Power Consumption

**What it measures**: Current power draw in watts.

| GPU | TDP | Typical Inference |
|-----|-----|-------------------|
| RTX Pro 6000 Blackwell | 350W | 200-300W |
| H100 | 700W | 400-600W |
| A100 | 400W | 250-350W |
| L40S | 350W | 200-300W |

**Dashboard Display**:
```
Power: 285W / 350W (81%)
```

---

## 📈 Inference Metrics

When running vLLM or other inference servers, additional metrics are available:

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

**What it measures**: Pending inference requests.

| Queue Size | Meaning |
|------------|---------|
| **0** | No backlog, instant responses |
| **1-5** | Light load, minimal wait |
| **5-20** | Moderate load |
| **20+** | Heavy load, consider scaling |

### KV Cache Utilization

**What it measures**: Attention cache usage for concurrent contexts.

```
KV Cache: 85% ████████░░
Active Sequences: 12
Max Sequences: 16
```

**When KV cache is full**:
- New requests wait in queue
- Consider `--max-num-seqs` adjustment
- Or reduce `--max-model-len`

---

## 🔄 Real-Time Updates

### Refresh Interval

The dashboard updates automatically:
- **Default**: Every 5 seconds
- **Configurable**: 1s, 5s, 10s, 30s, 60s

### Live Indicators

```
● Live (updating every 5s)    [Pause] [Refresh]
```

### Metric Sparklines

Mini charts showing recent trend:
```
GPU Util: 78% ▁▂▃▅▆█▇▆▅▄
Memory:   88% ▁▁▂▂▃▃▄▅▆█
```

---

## 📉 Historical Data

### Time Ranges

View historical metrics for:
- **Last 1 hour**: Fine-grained (1-minute intervals)
- **Last 6 hours**: Medium detail (5-minute intervals)
- **Last 24 hours**: Overview (15-minute intervals)
- **Last 7 days**: Long-term trend (1-hour intervals)
- **Last 30 days**: Monthly overview (4-hour intervals)

### Charts

Interactive time-series charts showing:
- GPU utilization over time
- Memory usage patterns
- Temperature fluctuations
- Request throughput
- Token generation rates

### Data Export

Download metrics for external analysis:

```bash
# Export as CSV
GET /api/gpu-metrics/export?format=csv&from=1705123456&to=1705209856

# Export as JSON
GET /api/gpu-metrics/export?format=json&from=1705123456&to=1705209856
```

---

## ⚠️ Alerts & Thresholds

### Setting Alerts

Configure warnings for:

| Metric | Default Threshold | Recommendation |
|--------|-------------------|----------------|
| GPU Utilization | > 95% for 5 min | May indicate overload |
| Memory Usage | > 95% | Risk of OOM errors |
| Temperature | > 80°C | Approaching throttle |
| Queue Size | > 50 | Scale or optimize |

### Alert Channels

Receive notifications via:
- **Dashboard**: In-app alerts
- **Email**: Configurable recipients
- **Webhook**: POST to your endpoint
- **Slack**: Integration available

### Example Webhook Payload

```json
{
  "alert_type": "threshold_exceeded",
  "metric": "gpu_memory_usage",
  "value": 96.5,
  "threshold": 95,
  "instance_id": "gpu-abc123",
  "gpu_index": 0,
  "timestamp": "2025-01-17T10:30:00Z",
  "message": "GPU memory usage exceeded 95% threshold"
}
```

---

## 🔧 Prometheus Integration

### Metrics Endpoint

vLLM exposes Prometheus metrics:

```bash
curl http://YOUR_ENDPOINT/metrics
```

### Key Prometheus Metrics

```prometheus
# GPU utilization
vllm:gpu_utilization{gpu="0"} 0.78

# Memory usage
vllm:gpu_memory_used_bytes{gpu="0"} 42949672960
vllm:gpu_memory_total_bytes{gpu="0"} 48654278656

# Inference metrics
vllm:num_requests_running 5
vllm:num_requests_waiting 2
vllm:generation_tokens_total 1234567
vllm:prompt_tokens_total 654321

# Cache metrics
vllm:gpu_cache_usage_perc{gpu="0"} 0.85
vllm:cpu_cache_usage_perc 0.12

# Latency
vllm:request_latency_seconds_bucket{le="0.5"} 1000
vllm:request_latency_seconds_bucket{le="1.0"} 1500
vllm:time_to_first_token_seconds_bucket{le="0.1"} 800
```

### Grafana Dashboard

Import our pre-built Grafana dashboard:

```json
{
  "dashboard_id": "packet-ai-gpu-metrics",
  "panels": [
    "GPU Utilization Gauge",
    "Memory Usage Timeline",
    "Token Throughput",
    "Request Latency Distribution",
    "Queue Depth Over Time"
  ]
}
```

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

### Get Current Metrics

```bash
GET /api/gpu-metrics/{instance_id}
Authorization: Bearer YOUR_API_KEY
```

**Response**:
```json
{
  "timestamp": "2025-01-17T10:30:00Z",
  "instance_id": "gpu-abc123",
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA RTX Pro 6000 Blackwell",
      "utilization": 78.5,
      "memory_used_gb": 42.5,
      "memory_total_gb": 48.0,
      "temperature_c": 72,
      "power_watts": 285,
      "power_limit_watts": 350
    }
  ],
  "inference": {
    "requests_running": 5,
    "requests_waiting": 2,
    "tokens_per_second": 87.3,
    "kv_cache_usage": 0.85
  }
}
```

### Get Historical Metrics

```bash
GET /api/gpu-metrics/{instance_id}/history?from=1705123456&to=1705209856&interval=5m
Authorization: Bearer YOUR_API_KEY
```

### Get Aggregated Stats

```bash
GET /api/gpu-metrics/{instance_id}/stats?period=24h
Authorization: Bearer YOUR_API_KEY
```

**Response**:
```json
{
  "period": "24h",
  "utilization": {
    "avg": 65.2,
    "max": 98.1,
    "min": 12.3
  },
  "memory": {
    "avg_gb": 38.5,
    "max_gb": 45.2
  },
  "tokens_generated": 1543210,
  "requests_completed": 8432
}
```

---

## 📚 Related Documentation

- [OpenAI-Compatible API Gateway](./openai-api-gateway.md)
- [Token Usage Dashboard](./token-usage.md)
- [Pro 6000 Blackwell Templates](./pro-6000-blackwell.md)
- [vLLM Multi-GPU Scaling](./vllm-multi-gpu-scaling.md)

---

**Last Updated**: January 2025 | **Version**: 1.0
