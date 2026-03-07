# vLLM Multi-GPU Scaling

*Created: 2025-12-29*
*Updated: 2025-12-29 - Single-node complete, multi-node planned*

## Overview

This document covers vLLM-specific scaling for LLM inference at GPU Cloud Platform.

**Related:** For multi-node clusters (Ray), see [Ray Cluster Management](./ray-cluster-management.md)

---

## Current Status

| Feature | Status | Notes |
|---------|--------|-------|
| Single-node tensor parallelism | **Complete** | `--tensor-parallel-size N` |
| Multi-node pipeline parallelism | Planned | Requires Ray cluster |

---

## Single-Node Scaling (Implemented)

When users deploy models to a subscription with multiple GPUs, vLLM automatically uses tensor parallelism.

**File:** `src/app/api/huggingface/deploy-existing/route.ts`

```typescript
const gpuCount = sub.per_pod_info?.vgpu_count || 1;

const script = generateDeployScript(deployScript, {
  modelId: catalogItem?.type !== "docker" ? hfItemId : undefined,
  dockerImage: catalogItem?.dockerImage,
  port: getDefaultPort(deployScript),
  hfToken: hfToken || undefined,
  gpuCount,  // Passed to vLLM as --tensor-parallel-size
});
```

---

## How It Works (Single-Node)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. User selects model + existing GPU subscription in dashboard         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Frontend calls POST /api/huggingface/deploy-existing                │
│     Body: { hfItemId: "meta-llama/Llama-3.3-70B", subscriptionId: "x" } │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. API fetches subscription from hosted.ai                             │
│     → sub.per_pod_info.vgpu_count = 2 (user has 2 GPUs)                │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. generateDeployScript() creates bash script with gpuCount=2          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. Script runs on GPU pod via SSH, starts vLLM:                        │
│                                                                         │
│     python -m vllm.entrypoints.openai.api_server \                      │
│       --model meta-llama/Llama-3.3-70B \                                │
│       --tensor-parallel-size 2 \    ← Splits model across 2 GPUs       │
│       --gpu-memory-utilization 0.8 \                                    │
│       --enforce-eager \                                                 │
│       --host 0.0.0.0 --port 8000                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## vLLM Parallelism Strategies

### 1. Tensor Parallelism (Within a Node) ✅ IMPLEMENTED

**What it does:** Splits model weights across multiple GPUs on the same physical node.

**How it works:**
- Column parallelism: Splits weight matrices along columns, concatenates results
- Row parallelism: Splits matrices along rows, sums partial results

**Requirements:**
- High-bandwidth interconnects (NVLink or InfiniBand) between GPUs
- All GPUs must be on the same physical node

**CLI Argument:**
```bash
--tensor-parallel-size 4  # Use 4 GPUs
```

**Visual representation:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│                          70B Parameter Model                            │
│                                                                         │
│   Without TP (single GPU):                                              │
│   ┌─────────────────────────────────────┐                               │
│   │ GPU 0: All 70B params (140GB VRAM) │ ← Won't fit on 80GB GPU!      │
│   └─────────────────────────────────────┘                               │
│                                                                         │
│   With TP=2 (tensor parallelism):                                       │
│   ┌─────────────────────┐ ┌─────────────────────┐                       │
│   │ GPU 0: 35B params   │ │ GPU 1: 35B params   │ ← Each fits 80GB     │
│   │ (70GB VRAM)         │ │ (70GB VRAM)         │                       │
│   └─────────────────────┘ └─────────────────────┘                       │
│            ↓                        ↓                                   │
│            └────── Combined via NVLink ──────┘                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Performance Note:** Can achieve super-linear scaling. Example: Llama 70B with TP=2 yielded 3.9x throughput improvement (not just 2x) due to larger KV cache enabling bigger batch sizes.

### 2. Pipeline Parallelism (Across Nodes) ✅ POSSIBLE (Not Yet Implemented)

**What it does:** Distributes contiguous model layers across multiple nodes.

**How it works:**
- Each node processes different layers of the model
- Intermediate activations transmitted between nodes as computation progresses

**Requirements:**
- Ray cluster for coordination
- Network connectivity between nodes ✅ **Available via hosted.ai team networking**
- Lower bandwidth requirements than tensor parallelism

**CLI Arguments:**
```bash
--pipeline-parallel-size 2  # Use 2 nodes
--distributed-executor-backend ray
```

**hosted.ai Networking:** All GPUs deployed by the same team share a private network with access to each other's internal IPs. This enables Ray cluster formation across pods.

**Visual representation:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Team Private Network (10.x.x.x)                     │
│                                                                         │
│   Pod A (Head Node)              Pod B (Worker Node)                    │
│   ┌─────────────────────┐       ┌─────────────────────┐                │
│   │ 10.0.1.5            │       │ 10.0.1.6            │                │
│   │ Layers 1-40         │◄─────►│ Layers 41-80        │                │
│   │ Ray Head :6379      │       │ Ray Worker          │                │
│   └─────────────────────┘       └─────────────────────┘                │
│            ↑                             ↑                              │
│            └───── Can communicate! ──────┘                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. Combined Strategy (For Very Large Models)

For very large models (e.g., Llama 405B):
- Use **tensor parallelism within nodes** (fast NVLink)
- Use **pipeline parallelism across nodes** (slower network OK)

```bash
vllm serve meta-llama/Llama-3.1-405B-FP8 \
  --tensor-parallel-size 4 \      # 4 GPUs per node
  --pipeline-parallel-size 5 \    # 5 nodes
  --distributed-executor-backend ray
```

---

## Multi-Node Ray Cluster Setup (Future)

### Head Node
```bash
ray start --block --head --port=6379
```

### Worker Nodes
```bash
ray start --block --address=${HEAD_IP}:6379
```

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `HF_TOKEN` | HuggingFace authentication |
| `TENSOR_PARALLEL_SIZE` | GPUs per node |
| `PIPELINE_PARALLEL_SIZE` | Number of nodes |

---

## What GPU Cloud Platform Has Implemented (Software Layer)

### 1. Single-Node Multi-GPU Support ✅ COMPLETE

**Status:** Fully implemented (2025-12-29)

When a user requests multiple GPUs in a single pod, the deploy script automatically uses:

```bash
# In huggingface-deploy-scripts.ts
--tensor-parallel-size ${gpu_count}
```

**Completed Items:**
- [x] `generateDeployScript()` accepts `gpuCount` parameter
- [x] GPU count passed from subscription to deploy script
- [x] `/api/huggingface/deploy` passes gpuCount
- [x] `/api/huggingface/deploy-existing` passes gpuCount

### 2. Future UI Improvements

**Potential improvements:**
- [ ] Show VRAM requirements per model in catalog
- [ ] Auto-calculate required GPUs based on model size
- [ ] Warn users if selected GPU config won't fit model
- [ ] Recommend multi-GPU for models > 30B parameters

### 3. Model-to-GPU Mapping

| Model | Parameters | VRAM Needed | Minimum GPUs |
|-------|-----------|-------------|--------------|
| Llama 3.2 3B | 3B | ~6GB | 1x 16GB |
| Llama 3.1 8B | 8B | ~16GB | 1x 24GB |
| Mistral 7B | 7B | ~14GB | 1x 16GB |
| Llama 3.1 70B | 70B | ~140GB | 2x 80GB |
| Llama 3.1 405B | 405B | ~800GB | 8+ GPUs |

---

## hosted.ai Infrastructure (Already Available)

### Team Private Networking ✅

**All GPUs deployed by the same team share a private network with access to each other's internal IPs.**

This means multi-node vLLM via Ray is possible without any infrastructure changes!

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Team: acme-corp                                     │
│                     Private Network: 10.x.x.0/24                        │
│                                                                         │
│   Subscription A          Subscription B          Subscription C        │
│   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐        │
│   │ 10.x.x.5    │◄──────►│ 10.x.x.6    │◄──────►│ 10.x.x.7    │        │
│   │ 2x H100     │        │ 2x H100     │        │ 2x H100     │        │
│   └─────────────┘        └─────────────┘        └─────────────┘        │
│         ↑                      ↑                      ↑                 │
│         └──────────── All can communicate! ───────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Nice-to-Have Features (Future)

1. **Shared Storage** - Model cache shared across pods (avoid downloading 400GB+ models to each pod)
2. **Pod Affinity** - Schedule related pods on same physical rack for lower latency

---

## Multi-Node Implementation Plan (Future Work)

With team networking confirmed, here's what GPU Cloud Platform would need to implement:

### Step 1: Get Pod Internal IPs

Need an API or method to discover internal IPs of all pods in a team's subscriptions.

```typescript
// Example: Get all pod IPs for a team
const pods = await getTeamPodIPs(teamId);
// Returns: [{ subscriptionId: "x", internalIP: "10.0.1.5" }, ...]
```

### Step 2: Ray Cluster Setup Scripts

**Head Node Script:**
```bash
#!/bin/bash
# Install Ray
pip install ray[default]

# Start Ray head
ray start --block --head --port=6379 --dashboard-host=0.0.0.0

# Note the head node IP for workers
echo "HEAD_IP=$(hostname -I | awk '{print $1}')"
```

**Worker Node Script:**
```bash
#!/bin/bash
# Install Ray
pip install ray[default]

# Connect to head node
ray start --block --address=${HEAD_IP}:6379
```

### Step 3: Multi-Node vLLM Launch

Once Ray cluster is formed:
```bash
vllm serve meta-llama/Llama-3.1-405B-FP8 \
  --tensor-parallel-size 4 \      # GPUs per node
  --pipeline-parallel-size 3 \    # Number of nodes
  --distributed-executor-backend ray
```

### Step 4: UI/API Changes Needed

1. **Cluster Creation Flow**
   - User selects model (e.g., Llama 405B)
   - System calculates required nodes
   - Creates N subscriptions
   - Runs Ray setup on each
   - Starts vLLM on head node

2. **Cluster Management**
   - View cluster status (all nodes)
   - Restart cluster
   - Scale up/down

3. **API Endpoints**
   - `POST /api/huggingface/deploy-cluster` - Deploy model across multiple pods
   - `GET /api/huggingface/cluster-status` - Check Ray cluster health

---

## Next Steps

### Completed ✅
1. Single-node tensor parallelism (`--tensor-parallel-size`)
2. GPU count passed from subscription to deploy script

### To Do (For Multi-Node)
1. [ ] Test pod-to-pod connectivity (ping internal IPs)
2. [ ] Get/document how to retrieve pod internal IPs from hosted.ai API
3. [ ] Create Ray cluster setup scripts
4. [ ] Build multi-node deploy API
5. [ ] Add cluster management UI

---

## References

- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)
- [Distributed Inference with vLLM - vLLM Blog](https://blog.vllm.ai/2025/02/17/distributed-inference.html)
- [Red Hat - Distributed Inference with vLLM](https://developers.redhat.com/articles/2025/02/06/distributed-inference-with-vllm)
- [Multi-node vLLM on MeluXina](https://docs.lxp.lu/howto/llama3-vllm/)
