# Persistent Storage Guide

This guide covers persistent storage for GPU pods on the GPU Cloud Platform.

## Overview

Persistent storage allows your data to survive pod restarts, reimaging, and scaling operations. Unlike ephemeral storage (which is wiped when pods are stopped), persistent storage uses network-attached NFS volumes that retain data across all pod lifecycle events.

### Key Features

- **Survives Restarts**: Data persists when pods are restarted
- **Survives Reimaging**: Data retained when changing pod images
- **Survives Scaling**: Data persists through scale up/down operations
- **NFS-Based**: Uses high-performance network file system
- **Automatic Mounting**: Volumes are automatically mounted at `/data/shareXX`

### Storage Tiers

| Block Type | Size | Price/Hour | Use Case |
|------------|------|------------|----------|
| Block-10 | 10 GB | ~$0.002 | Small datasets, model checkpoints |
| Block-20 | 20 GB | ~$0.004 | Medium datasets, multiple models |
| Block-50 | 50 GB | ~$0.010 | Large datasets, training outputs |

## Using Persistent Storage

### At Launch Time

When launching a new GPU pod through the dashboard:

1. Click **Launch GPU**
2. Select your GPU pool and instance type
3. Under **Persistent Storage**, select a storage block size
4. Click **Launch**

The persistent storage volume is created automatically and attached to your pod.

### Accessing Your Storage

Once your pod is running, persistent storage is mounted at:

```bash
/data/shareXX/
```

You can verify the mount with:

```bash
sudo df -h | grep data
# Example output:
# 192.168.100.31:/shares/gpu-storage-1735060000  50G  1.2G  49G  3% /data/shareXX

sudo ls -la /data/
```

### Recommended Workflows

#### Storing HuggingFace Models

```bash
# Set HuggingFace cache to persistent storage
sudo export HF_HOME=/data/shareXX/hf-cache

# Models will now be cached to persistent storage
sudo python -c "from transformers import AutoModel; AutoModel.from_pretrained('bert-base-uncased')"
```

#### Storing Training Checkpoints

```python
import torch

# Save checkpoints to persistent storage
checkpoint_dir = "/data/shareXX/checkpoints"
torch.save(model.state_dict(), f"{checkpoint_dir}/model_epoch_{epoch}.pt")
```

#### Using with vLLM

```bash
# Run vLLM with model cache on persistent storage
sudo export HF_HOME=/data/shareXX/models

sudo python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port 8000
```

## Technical Details

### Architecture

Persistent storage uses NFS (Network File System) provided by hosted.ai's storage infrastructure:

```
┌─────────────────┐     NFS Mount     ┌─────────────────┐
│   GPU Pod       │ ───────────────── │   NFS Server    │
│ /data/shareXX/  │     192.168.x.x   │   Storage Pool  │
└─────────────────┘                   └─────────────────┘
```

### Access Control

- Storage volumes are provisioned with IP-based access control
- Only pods from the same team can access the volume
- Access is configured at provisioning time

### Limitations

1. **Cannot Add After Launch**: Storage cannot be added to running pods. It must be selected at launch time.

2. **One Subscription Per Pool**: Each team can have one active subscription per GPU pool. To use storage on multiple pods, you'd need subscriptions to different pools.

3. **Same Region Only**: Storage volumes are region-specific and can only be attached to pods in the same region.

4. **NFS Overhead**: Network-attached storage has slightly higher latency than local SSD. For maximum I/O performance, copy working files to local ephemeral storage first.

### Performance Tips

```bash
# For best performance with large files, copy to local storage first
sudo cp /data/shareXX/large-dataset.tar /tmp/
sudo tar -xf /tmp/large-dataset.tar -C /tmp/data/

# Work with local copy, then sync back
sudo rsync -av /tmp/results/ /data/shareXX/results/
```

## Billing

Persistent storage is billed per hour of usage:

- Billing starts when the volume is created
- Billing continues while the volume exists (even if pod is stopped)
- Storage costs appear in your dashboard under "Storage" breakdown
- View detailed storage costs in the billing summary

### Example Billing

| Resource | Hours | Cost |
|----------|-------|------|
| GPU (L40S) | 24h | $28.80 |
| Storage (50GB) | 24h | $0.24 |
| **Total** | - | **$29.04** |

## API Reference

### Create GPU with Storage (POST /api/instances)

```javascript
// Request
POST /api/instances
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "my-gpu-pod",
  "pool_id": 1,
  "vgpus": 1,
  "persistent_storage_block_id": "Block-50"  // 10, 20, or 50 GB
}

// Response
{
  "success": true,
  "subscription_id": 123,
  "message": "GPU pool subscription created successfully"
}
```

### Get Storage Information (GET /api/instances)

```javascript
// Response includes storage_details
{
  "poolSubscriptions": [{
    "id": 123,
    "status": "running",
    "storage_details": {
      "ephemeral_storage_gb": 100,
      "shared_volumes": [{
        "name": "gpu-storage-1735060000",
        "mount_point": "/data/shareXX",
        "size_in_gb": 50
      }]
    }
  }]
}
```

### Get Billing with Storage Breakdown (GET /api/account/billing-stats)

```javascript
// Response includes storage costs
{
  "totalCost": 29.04,
  "gpuHours": 24,
  "storageCost": 0.24,
  "storageHours": 24,
  "storageVolumes": [{
    "name": "gpu-storage-1735060000",
    "hours": 24,
    "cost": 0.24
  }]
}
```

## Troubleshooting

### Storage Not Visible

If you don't see your storage mount:

```bash
# Check mount status
sudo mount | grep nfs

# Check if mount point exists
sudo ls -la /data/

# Check NFS connectivity
sudo showmount -e 192.168.100.31
```

### Permission Denied

NFS mounts run as a specific user. Use sudo if needed:

```bash
sudo mkdir /data/shareXX/new-folder
sudo chown $USER:$USER /data/shareXX/new-folder
```

### Slow Performance

For I/O intensive workloads:

```bash
# Copy data locally for processing
sudo cp -r /data/shareXX/dataset /tmp/dataset

# Process locally, then sync back
# ...

sudo rsync -av /tmp/output/ /data/shareXX/output/
```

## FAQs

### Can I share storage between pods?

Currently, storage volumes can only be attached to one pod at a time due to the one-subscription-per-pool constraint. If you need shared storage across multiple concurrent pods, contact support.

### Can I resize my storage?

To change storage size, you would need to:
1. Copy data from current storage
2. Terminate the current pod
3. Launch a new pod with different storage size
4. Copy data to new storage

### What happens if my pod crashes?

Your persistent storage data is safe! The NFS volume exists independently of your pod. When the pod restarts, the storage is automatically remounted.

### Can I access storage after terminating my pod?

Storage volumes are currently tied to pod subscriptions. When you terminate a pod, the associated storage is also deleted. Always backup important data before terminating.

---

**Last Updated**: January 2025
**Questions?** Contact support@example.com
