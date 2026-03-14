# Ray Cluster Management

*Created: 2025-12-29*
*Status: Planning*

## Overview

Ray clusters provide a general-purpose distributed computing layer for Packet.ai users. This is independent of any specific workload (vLLM, training, etc.) and serves as infrastructure that applications can run on top of.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Application Layer (User's Choice)                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ vLLM        │  │ PyTorch     │  │ DeepSpeed   │  │ Custom      │   │
│  │ Inference   │  │ Training    │  │ Training    │  │ Ray Apps    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Ray Cluster Layer (Packet.ai Manages)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ Ray Cluster                                                         ││
│  │ • Head node (coordinator, GCS, dashboard)                           ││
│  │ • N worker nodes (GPU compute)                                      ││
│  │ • Private networking between all nodes                              ││
│  │ • Automatic node discovery via internal IPs                         ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Infrastructure Layer (hosted.ai)                                       │
│  • GPU subscriptions (pods)                                             │
│  • Team private network (all pods can communicate)                      │
│  • SSH access to each pod                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Why Ray?

Ray is the standard for distributed Python workloads:

| Use Case | Ray Library | Description |
|----------|-------------|-------------|
| **LLM Inference** | vLLM | Multi-GPU/multi-node model serving |
| **Distributed Training** | Ray Train | PyTorch, TensorFlow, DeepSpeed |
| **Hyperparameter Tuning** | Ray Tune | Distributed hyperparameter search |
| **Data Processing** | Ray Data | Scalable data pipelines |
| **Reinforcement Learning** | Ray RLlib | Distributed RL training |
| **Custom Apps** | Ray Core | Any distributed Python code |

---

## Cluster Lifecycle

### 1. Create Cluster

```
User requests: "Create 3-node Ray cluster"
    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Packet.ai creates 3 GPU subscriptions                                  │
│  (or uses existing subscriptions selected by user)                      │
└─────────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Wait for all pods to be Running                                        │
└─────────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  SSH into each pod, get internal IP                                     │
│  Pod A: 10.0.1.5                                                        │
│  Pod B: 10.0.1.6                                                        │
│  Pod C: 10.0.1.7                                                        │
└─────────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Pod A (Head): ray start --head --port=6379                             │
│  Pod B: ray start --address=10.0.1.5:6379                               │
│  Pod C: ray start --address=10.0.1.5:6379                               │
└─────────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Cluster ready! Dashboard at http://10.0.1.5:8265                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Use Cluster

Once the cluster is running, users can:

**Option A: SSH into head node and run commands**
```bash
# From head node
python my_training_script.py
```

**Option B: Submit jobs via Ray Jobs API**
```bash
ray job submit --address http://10.0.1.5:8265 -- python my_script.py
```

**Option C: Use Packet.ai deploy buttons**
- "Deploy vLLM to cluster" (for LLM inference)
- "Run training job" (for distributed training)

### 3. Destroy Cluster

```
User clicks "Destroy Cluster"
    ↓
Ray processes stopped on all nodes
    ↓
(Optional) Unsubscribe from GPU pools
```

---

## API Design

### Cluster Management Endpoints

```typescript
// Create a new Ray cluster from existing subscriptions
POST /api/cluster/create
{
  subscriptionIds: ["sub-1", "sub-2", "sub-3"],
  headNodeIndex: 0  // Which subscription is head (default: first)
}
→ { clusterId: "cluster-xyz", headIP: "10.0.1.5", status: "creating" }

// Get cluster status
GET /api/cluster/{clusterId}/status
→ {
    clusterId: "cluster-xyz",
    status: "running",
    headNode: {
      subscriptionId: "sub-1",
      internalIP: "10.0.1.5",
      rayStatus: "alive"
    },
    workerNodes: [
      { subscriptionId: "sub-2", internalIP: "10.0.1.6", rayStatus: "alive" },
      { subscriptionId: "sub-3", internalIP: "10.0.1.7", rayStatus: "alive" }
    ],
    dashboardUrl: "http://10.0.1.5:8265"
  }

// List clusters for a team
GET /api/cluster?teamId={teamId}
→ { clusters: [...] }

// Destroy cluster (stops Ray, optionally keeps subscriptions)
DELETE /api/cluster/{clusterId}
{
  keepSubscriptions: true  // If false, also unsubscribes from pools
}

// Add node to existing cluster
POST /api/cluster/{clusterId}/add-node
{
  subscriptionId: "sub-4"
}

// Remove node from cluster
DELETE /api/cluster/{clusterId}/node/{subscriptionId}
```

---

## Setup Scripts

### Head Node Setup

```bash
#!/bin/bash
set -e

# Install Ray if not present
if ! command -v ray &> /dev/null; then
    pip install "ray[default]>=2.9.0"
fi

# Get internal IP
INTERNAL_IP=$(hostname -I | awk '{print $1}')

# Start Ray head
ray stop --force 2>/dev/null || true
ray start --head \
    --port=6379 \
    --dashboard-host=0.0.0.0 \
    --dashboard-port=8265 \
    --include-dashboard=true

echo "RAY_HEAD_IP=${INTERNAL_IP}"
echo "RAY_HEAD_STARTED=true"
```

### Worker Node Setup

```bash
#!/bin/bash
set -e

HEAD_IP="${1}"

if [ -z "$HEAD_IP" ]; then
    echo "Usage: worker-setup.sh <head_ip>"
    exit 1
fi

# Install Ray if not present
if ! command -v ray &> /dev/null; then
    pip install "ray[default]>=2.9.0"
fi

# Stop any existing Ray
ray stop --force 2>/dev/null || true

# Connect to head
ray start --address="${HEAD_IP}:6379"

echo "RAY_WORKER_STARTED=true"
```

### Health Check Script

```bash
#!/bin/bash
# Run on any node to check cluster health

ray status
```

---

## Model Compatibility Notes

Not all workloads work perfectly with Ray. Key considerations:

### vLLM + Ray

| Model Type | Ray Support | Notes |
|------------|-------------|-------|
| Standard (LLaMA, Mistral) | Excellent | Works well |
| MoE (Mixtral, DeepSeek) | Good | TP must divide expert count |
| Quantized (AWQ, GPTQ) | Good | Some edge cases |
| Custom (`trust-remote-code`) | Variable | Test before deploying |

### Distributed Training

| Framework | Ray Integration |
|-----------|-----------------|
| PyTorch DDP | Excellent (via Ray Train) |
| DeepSpeed | Excellent |
| FSDP | Good |
| Megatron-LM | Requires custom setup |

---

## Database Schema (Future)

```prisma
model RayCluster {
  id            String   @id @default(cuid())
  teamId        String
  name          String?
  status        String   // creating, running, failed, stopped
  headNodeSubId String   // Subscription ID of head node
  headNodeIP    String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  nodes         RayClusterNode[]
}

model RayClusterNode {
  id             String     @id @default(cuid())
  clusterId      String
  subscriptionId String
  internalIP     String?
  role           String     // head, worker
  status         String     // pending, running, failed

  cluster        RayCluster @relation(fields: [clusterId], references: [id])
}
```

---

## UI Components (Future)

### Cluster Dashboard Tab

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Clusters                                                    [+ New]    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ my-training-cluster                              ● Running        │ │
│  │ 3 nodes • 12 GPUs • Created 2 hours ago                          │ │
│  │                                                                   │ │
│  │ Head: 10.0.1.5    Workers: 10.0.1.6, 10.0.1.7                    │ │
│  │                                                                   │ │
│  │ [Dashboard] [SSH] [Add Node] [Destroy]                           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ inference-cluster                                ● Running        │ │
│  │ 2 nodes • 8 GPUs • Created 1 day ago                             │ │
│  │                                                                   │ │
│  │ [Deploy vLLM] [Dashboard] [Destroy]                              │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Create Cluster Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Create Ray Cluster                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Cluster Name: [my-cluster________________]                             │
│                                                                         │
│  Select GPUs to include:                                                │
│                                                                         │
│  ☑ gpu-sub-1    4x H100    Running    (Head Node)                      │
│  ☑ gpu-sub-2    4x H100    Running                                     │
│  ☑ gpu-sub-3    4x H100    Running                                     │
│  ☐ gpu-sub-4    2x A100    Running                                     │
│                                                                         │
│  Total: 12 GPUs across 3 nodes                                          │
│                                                                         │
│                                              [Cancel] [Create Cluster]  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

### Phase 1: Core Cluster Management
1. [ ] Internal IP discovery via SSH
2. [ ] Head node setup script
3. [ ] Worker node setup script
4. [ ] `/api/cluster/create` endpoint
5. [ ] `/api/cluster/{id}/status` endpoint
6. [ ] `/api/cluster/{id}` DELETE endpoint

### Phase 2: UI
1. [ ] Clusters tab in dashboard
2. [ ] Create cluster modal
3. [ ] Cluster detail view
4. [ ] Ray dashboard link/embed

### Phase 3: Integrations
1. [ ] "Deploy vLLM to cluster" button
2. [ ] Job submission UI
3. [ ] Cluster auto-scaling

---

## References

- [Ray Documentation](https://docs.ray.io/)
- [Ray Cluster Setup](https://docs.ray.io/en/latest/cluster/getting-started.html)
- [vLLM Distributed Inference](https://docs.vllm.ai/en/stable/serving/distributed_serving.html)
- [Ray Train](https://docs.ray.io/en/latest/train/train.html)
