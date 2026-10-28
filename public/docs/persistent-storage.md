# Persistent Storage Guide

This guide covers persistent storage for GPU pods on Packet.ai.

## Overview

Persistent storage allows your data to survive pod restarts, stop/start cycles, and even pod termination. Unlike local ephemeral storage (which is lost when a pod is terminated), persistent storage uses network-attached NFS volumes that exist independently of your pods.

### Key Features

- **Survives Restarts**: Data persists when pods are restarted
- **Survives Termination**: Volumes are independent of pods and can be re-attached to new pods
- **NFS-Based**: Uses high-performance network file system
- **Automatic Mounting**: Volumes are automatically mounted at `/data/shareXX`

### Storage Options

Available volume sizes vary by region. When you launch a GPU (or add storage to a running one), the dashboard lists each available size with its hourly price, so you can see the exact cost before creating a volume. Storage is billed per GB per hour for as long as the volume exists.

## Using Persistent Storage

### At Launch Time

When launching a new GPU pod through the dashboard:

1. Click **Launch GPU**
2. Select your GPU type, product, and region
3. Under **Persistent Storage**, choose one of:
   - **None** — local storage only (data lost on termination)
   - **Create new volume** — pick a size; the volume is created and attached automatically
   - **Use existing volume** — re-attach a volume you already own in that region
4. Click **Launch GPU**

Note: not every GPU type supports persistent shared storage. If your selected GPU doesn't, the storage size options won't be offered (and API requests for storage on that GPU are rejected).

### Adding Storage to a Running GPU

You can also attach storage to a GPU that's already running:

1. Find your GPU card in the dashboard
2. Click **Storage** on the card
3. Attach an existing available volume, or create a new one from the listed sizes

Attaching storage to a running GPU briefly restarts the pod.

### Managing Volumes

The **Storage** tab in the dashboard sidebar lists all your volumes with their size, status (attached / available), mount point, and hourly cost. Available (unattached) volumes can be deleted there to stop billing; attached volumes must be detached first (terminate the GPU they're attached to). Deleting a volume also deletes any snapshots that reference it — the dashboard warns you before doing so.

### Accessing Your Storage

Once your pod is running, persistent storage is mounted at:

```bash
/data/shareXX/
```

You can verify the mount with:

```bash
sudo df -h | grep data
# Example output:
# 192.168.100.31:/shares/my-gpu-pod-storage-1735060000  50G  1.2G  49G  3% /data/shareXX

sudo ls -la /data/
```

### Recommended Workflows

#### Storing HuggingFace Models

```bash
# Set HuggingFace cache to persistent storage
export HF_HOME=/data/shareXX/hf-cache

# Models will now be cached to persistent storage
python -c "from transformers import AutoModel; AutoModel.from_pretrained('bert-base-uncased')"
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
export HF_HOME=/data/shareXX/models

python -m vllm.entrypoints.openai.api_server \
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

1. **One Pod at a Time**: A volume can only be attached to one pod at a time. It must be in the *available* state (not attached elsewhere) before it can be attached.

2. **Attaching Restarts the Pod**: Adding storage to a running GPU briefly restarts it. Data on the persistent volume is unaffected.

3. **Same Region Only**: Storage volumes are region-specific and can only be attached to pods in the same region.

4. **Not All GPU Types**: Some GPU types do not support persistent shared storage. The storage options are hidden for those GPUs.

5. **No Standalone Detach**: To detach a volume from a pod, terminate the pod — the volume then becomes available for re-attachment or deletion.

6. **NFS Overhead**: Network-attached storage has slightly higher latency than local SSD. For maximum I/O performance, copy working files to local ephemeral storage first.

### Performance Tips

```bash
# For best performance with large files, copy to local storage first
sudo cp /data/shareXX/large-dataset.tar /tmp/
sudo tar -xf /tmp/large-dataset.tar -C /tmp/data/

# Work with local copy, then sync back
sudo rsync -av /tmp/results/ /data/shareXX/results/
```

## Billing

Persistent storage is billed per GB per hour:

- Billing starts when the volume is created
- Billing continues while the volume exists — even if the pod is stopped or terminated. Delete unused volumes from the **Storage** tab to stop charges
- Usage is metered roughly every 30 minutes and deducted from your wallet balance
- Storage costs appear in your dashboard as a separate "storage" line next to GPU spend, and per volume in the **Storage** tab

### Example Billing

Rates below are illustrative — your actual GPU and storage rates are shown in the dashboard:

| Resource       | Hours | Cost       |
| -------------- | ----- | ---------- |
| GPU (L40S)     | 24h   | $28.80     |
| Storage (50GB) | 24h   | $0.24      |
| **Total**      | -     | **$29.04** |

## API Reference

### List Available Storage Sizes (GET /api/instances/shared-volumes/storage-blocks)

```javascript
// Request
GET /api/instances/shared-volumes/storage-blocks?region_id=<region_id>
Authorization: Bearer <token>

// Response — blocks sorted by size, ascending
{
  "blocks": [
    { "id": "<storage-block-id>", "name": "...", "size": 50, "cost": "0.01" }
  ]
}
```

### Create GPU with Storage (POST /api/instances)

```javascript
// Request
POST /api/instances
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "my-gpu-pod",
  "product_id": "<gpu-product-id>",
  "region_id": 1,
  "new_storage_block_id": "<storage-block-id>"  // create a new volume of this size
  // or: "existing_shared_volume_id": 42        // attach a volume you already own
}

// Response
{
  "success": true,
  "instance_id": "<instance-id>",
  "deploy_status": "provisioning",
  "message": "GPU deployment started — provisioning."
}
```

### Add Storage to a Running GPU (POST /api/instances/pool-subscription/{id}/add-storage)

```javascript
// Request — one of volume_id (attach existing) or storage_block_id (create new)
{
  "storage_block_id": "<storage-block-id>"
}

// Response
{
  "success": true,
  "volume_id": 42,
  "message": "Storage volume is being attached. The GPU will restart briefly."
}
```

### List Your Volumes (GET /api/instances/shared-volumes)

```javascript
// Response
{
  "volumes": [{
    "id": 42,
    "name": "my-gpu-pod-storage-1735060000",
    "size_in_gb": 50,
    "region_id": 1,
    "status": "attached",     // or "available"
    "mount_point": "/data/shareXX",
    "cost": 0.01              // $/hour
  }]
}
```

Available volumes can be deleted with `DELETE /api/instances/shared-volumes` and a body of `{ "volume_id": 42 }`.

### Get Storage Information (GET /api/instances)

```javascript
// Response includes storage_details per instance
{
  "poolSubscriptions": [{
    "id": "<instance-id>",
    "status": "running",
    "storage_details": {
      "ephemeral_storage_gb": 100,
      "shared_volumes": [{
        "id": "42",
        "name": "my-gpu-pod-storage-1735060000",
        "mount_point": "/data/shareXX",
        "size_in_gb": 50
      }]
    }
  }]
}
```

### Get Billing with Storage Breakdown (GET /api/account/billing-stats)

Requires a role with billing visibility on the team.

```javascript
// Response includes storage costs
{
  "totalCost": 29.04,
  "gpuHours": 24,
  "storageCost": 0.24,
  "storageHours": 24,
  "storageVolumes": [{
    "name": "my-gpu-pod-storage-1735060000",
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

# Check NFS connectivity (use the server IP shown in the df output)
sudo showmount -e <nfs-server-ip>
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

A storage volume can only be attached to one pod at a time. You can move data between pods by terminating one pod (the volume becomes available) and attaching the volume to another. If you need shared storage across multiple concurrent pods, contact support.

### Can I resize my storage?

Volumes cannot be resized in place. To move to a larger volume:

1. Create a new volume of the desired size and attach it — either to your running pod (via **Storage** on the GPU card) or to a new pod at launch
2. Copy your data across
3. Once the old volume is detached (its pod terminated), delete it from the **Storage** tab to stop billing

### What happens if my pod crashes?

Your persistent storage data is safe! The NFS volume exists independently of your pod. When the pod restarts, the storage is automatically remounted.

### Can I access storage after terminating my pod?

Yes. Storage volumes are independent of pods and survive termination — the volume becomes *available* and keeps your data (and keeps billing) until you delete it. Attach it to a new pod with **Use existing volume** at launch time, or delete it from the **Storage** tab when you no longer need it.

---

**Last Updated**: July 2026
**Questions?** Contact help@packet.ai
