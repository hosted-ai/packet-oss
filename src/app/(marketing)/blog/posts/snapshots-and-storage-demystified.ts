/**
 * Snapshots and Storage Demystified Blog Post
 *
 * A comprehensive, technical deep dive into how GPU pod snapshots
 * work with persistent vs ephemeral storage.
 *
 * @module blog/posts/snapshots-and-storage-demystified
 */

import type { BlogPost } from "./types";

export const snapshotsAndStorageDemystified: BlogPost = {
  slug: "snapshots-and-storage-demystified",
  title: "GPU Snapshots Demystified: What Actually Survives Pod Termination",
  excerpt:
    "Confused about what persists when you terminate your GPU pod? Here's a deep technical dive into the difference between snapshots, persistent storage, and ephemeral disk — and why 'snapshot' doesn't mean what you think it means.",
  content: `
# GPU Snapshots Demystified: What Actually Survives Pod Termination

If you've ever terminated a GPU pod, created a snapshot, restored it, and wondered "where did my pip packages go?" — this post is for you. We're going to dig into exactly how snapshots and storage work, why they're designed this way, and how to use them effectively.

Spoiler: "snapshot" in cloud GPU land is very different from a traditional VM snapshot.

## The Mental Model Problem

When you hear "snapshot," you probably think of VMware or VirtualBox snapshots — a complete point-in-time image of an entire virtual machine, including RAM, disk state, and all running processes. Restore the snapshot, and everything is exactly as you left it.

**That's not what GPU pod snapshots are.**

Cloud GPU pods run in containers (typically Kubernetes pods), and container infrastructure works fundamentally differently. Understanding this difference is crucial to not losing data.

## Container Ephemeral Filesystems: A Primer

Containers use a layered filesystem (usually overlayfs or similar). Here's the key insight:

\`\`\`
┌─────────────────────────────────────────────┐
│           Writable Layer (ephemeral)         │
│  - Your pip installs go here                │
│  - Your /home/ubuntu changes go here        │
│  - Your /tmp files go here                  │
│  - GONE when container stops                │
├─────────────────────────────────────────────┤
│           Container Image Layers            │
│  - CUDA drivers                             │
│  - Python runtime                           │
│  - Base system packages                     │
│  - Read-only, shared across containers      │
└─────────────────────────────────────────────┘
\`\`\`

When you \`pip install torch\`, the packages are written to the writable layer. When you modify \`~/.bashrc\`, that's the writable layer. When you download a dataset to \`/home/ubuntu/data/\`, that's the writable layer.

**The writable layer is deleted when the container stops.** This is by design — it's what makes containers lightweight, fast to start, and easy to scale.

## What a GPU Pod Snapshot Actually Contains

When you create a snapshot of your GPU pod on Packet, we save:

\`\`\`json
{
  "displayName": "my-vllm-setup",
  "snapshotType": "full",
  "poolId": "12",
  "poolName": "H100 80GB NVLink",
  "vgpus": 1,
  "instanceTypeId": "medium",
  "imageUuid": "abc123...",
  "persistentVolumeId": 42,
  "persistentVolumeName": "my-storage-volume",
  "persistentVolumeSize": 50,
  "hfItemId": "meta-llama/Llama-3.1-8B-Instruct",
  "deployScript": "vllm"
}
\`\`\`

This is a **configuration bookmark**, not a disk image. It records:

1. **GPU configuration** — which pool, how many GPUs, instance type
2. **Container image** — the base image UUID (with CUDA, drivers, etc.)
3. **Storage reference** — a pointer to your persistent volume (if attached)
4. **Deployment settings** — HuggingFace model, deploy script

Notice what's NOT saved:
- Contents of \`/home/ubuntu\`
- Installed pip packages
- Running processes
- Files in \`/tmp\`
- Any data outside the mounted persistent volume

## The Two Storage Worlds

Here's the critical distinction:

### Ephemeral Storage (Local SSD)

\`\`\`
┌─────────────────────────────────────────────┐
│              Ephemeral Storage               │
│                                             │
│  /home/ubuntu/        ← Your home directory │
│  /tmp/                ← Temporary files     │
│  /root/               ← Root's home         │
│  /var/                ← System files        │
│  /opt/                ← Optional packages   │
│                                             │
│  ⚡ Fast (local NVMe SSD)                   │
│  💀 DESTROYED on pod termination            │
└─────────────────────────────────────────────┘
\`\`\`

Everything here is gone when your pod terminates. Period. No exceptions. The "snapshot" doesn't save any of it.

### Persistent Storage (NFS Volume)

\`\`\`
┌─────────────────────────────────────────────┐
│              Persistent Storage              │
│                                             │
│  /data/shareXX/                              │
│  ├── models/          ← Your LLM weights   │
│  ├── data/            ← Your datasets      │
│  ├── checkpoints/     ← Training checkpoints│
│  └── code/            ← Your scripts       │
│                                             │
│  🐢 Slower (network-attached NFS)           │
│  ✅ SURVIVES pod termination                │
│  💰 Billed separately (hourly)              │
└─────────────────────────────────────────────┘
\`\`\`

The persistent volume is a completely separate entity. It's a network-attached NFS volume that exists independently of your pod. When you terminate the pod, the volume keeps existing (and keeps billing).

## The Snapshot + Storage Dance

Here's the actual workflow:

\`\`\`
Time T0: You launch a pod with 50GB persistent storage
         ├── Fresh container with ephemeral /home/ubuntu
         └── Volume mounted at /data/shareXX/

Time T1: You install packages, download models
         ├── pip packages → /home/ubuntu/.local/ (ephemeral)
         ├── LLM weights → /data/shareXX/models/ (persistent)
         └── Custom scripts → /data/shareXX/code/ (persistent)

Time T2: You create a snapshot
         └── Saves: config + reference to volume ID 42

Time T3: You terminate the pod
         ├── Container destroyed (all ephemeral data gone)
         └── Volume ID 42 still exists (NFS server)

Time T4: You restore from snapshot
         ├── NEW container created (fresh ephemeral /home/ubuntu)
         └── Volume ID 42 re-mounted at /data/shareXX/

Result:
  ✅ /data/shareXX/models/ → your weights are there
  ✅ /data/shareXX/code/ → your scripts are there
  ❌ /home/ubuntu/.local/lib/python3.x/ → empty, pip packages gone
  ❌ Your ~/.bashrc customizations → gone (fresh container)
\`\`\`

## The Volume Lookup: A Technical Aside

When you restore from a snapshot, how does the system find your volume?

Our snapshot stores both \`persistentVolumeId\` (the numeric ID) and \`persistentVolumeName\` (the human-readable name). When restoring:

1. If we have the volume ID → attach directly
2. If we only have the name → query the hosted.ai API for matching volumes in your team
3. Verify the volume exists and is in AVAILABLE state
4. Include the volume ID in the subscription request

\`\`\`typescript
// Simplified logic from our restore endpoint
if (snapshot.persistentVolumeId) {
  sharedVolumeIds.push(snapshot.persistentVolumeId);
} else if (snapshot.persistentVolumeName) {
  const teamVolumes = await getSharedVolumes(teamId);
  const match = teamVolumes.find(
    v => v.name === snapshot.persistentVolumeName && v.status === "AVAILABLE"
  );
  if (match) sharedVolumeIds.push(match.id);
}
\`\`\`

This two-tier lookup handles both new snapshots (which store the ID) and legacy snapshots (which only had the name).

## Real-World Workflows

### Workflow 1: LLM Inference

\`\`\`bash
# DO THIS: Store model weights in persistent storage
sudo export HF_HOME=/data/shareXX/huggingface
sudo huggingface-cli download meta-llama/Llama-3.1-8B-Instruct

# After restore, the weights are still there
# You just need to re-install vllm (ephemeral)
sudo pip install vllm
sudo python -m vllm.entrypoints.openai.api_server \\
  --model /data/shareXX/huggingface/meta-llama/Llama-3.1-8B-Instruct
\`\`\`

### Workflow 2: Training with Checkpoints

\`\`\`python
# GOOD: Checkpoints to persistent storage
checkpoint_dir = "/data/shareXX/checkpoints"

trainer = Trainer(
    model=model,
    args=TrainingArguments(
        output_dir=checkpoint_dir,
        save_strategy="steps",
        save_steps=500,
    ),
)
trainer.train()

# After restore: resume from the last checkpoint
trainer.train(resume_from_checkpoint=True)
\`\`\`

### Workflow 3: Reproducible Environment

Want pip packages to survive? Install them to persistent storage:

\`\`\`bash
# Create a persistent pip directory
sudo mkdir -p /data/shareXX/pip-packages

# Install packages to it
sudo pip install --target=/data/shareXX/pip-packages torch transformers

# Add to PYTHONPATH in your startup script
export PYTHONPATH=/data/shareXX/pip-packages:\$PYTHONPATH
\`\`\`

Or use conda with a persistent prefix:

\`\`\`bash
sudo conda create --prefix /data/shareXX/envs/myenv python=3.11
sudo conda activate /data/shareXX/envs/myenv
sudo conda install pytorch -c pytorch
# This environment survives termination
\`\`\`

## The Architecture Diagram

\`\`\`
                                    ┌─────────────────────────────┐
                                    │     PERSISTENT STORAGE      │
                                    │   (NFS server, always on)   │
                                    │                             │
                                    │  Volume: shareXX (50GB)     │
                                    │  ├── models/                │
                                    │  ├── data/                  │
                                    │  └── code/                  │
                                    │                             │
                                    │  💾 Survives termination    │
                                    │  💰 Billed hourly           │
                                    └──────────────┬──────────────┘
                                                   │
                                                   │ NFS mount
                                                   │
┌──────────────────────────────────────────────────┼──────────────────────────────────────────────────┐
│                               GPU POD (Kubernetes pod)                                              │
│                                                  │                                                  │
│  ┌───────────────────────────┐    ┌─────────────┴─────────────┐                                     │
│  │    EPHEMERAL STORAGE      │    │        MOUNT POINT         │                                    │
│  │    (container layer)      │    │                            │                                    │
│  │                           │    │   /data/shareXX/            │                                    │
│  │  /home/ubuntu/            │    │   ├── models/ → real data  │                                    │
│  │  ├── .local/pip/  💀     │    │   ├── data/   → real data  │                                    │
│  │  ├── .bashrc      💀     │    │   └── code/   → real data  │                                    │
│  │  └── downloads/   💀     │    │                            │                                    │
│  │                           │    │   ✅ Data persists         │                                    │
│  │  /tmp/            💀     │    └────────────────────────────┘                                    │
│  │  /var/            💀     │                                                                      │
│  │                           │                                                                      │
│  │  💀 = GONE on terminate  │                                                                      │
│  └───────────────────────────┘                                                                      │
│                                                                                                     │
│  Container resources: H100 80GB, 32 vCPU, 128GB RAM                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          SNAPSHOT                                                   │
│                                                                                                     │
│  {                                                                                                  │
│    poolId: 12,              // H100 80GB pool                                                       │
│    vgpus: 1,                // Number of GPUs                                                       │
│    instanceTypeId: "medium",// CPU/RAM config                                                       │
│    persistentVolumeId: 42,  // Reference to storage                                                 │
│    hfModel: "llama-3.1-8b"  // Model deployment config                                              │
│  }                                                                                                  │
│                                                                                                     │
│  📝 Configuration only — NOT a disk image                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
\`\`\`

## Why This Design?

You might wonder: why not just do full VM snapshots?

1. **Speed** — Spinning up a new container takes seconds. Restoring a 500GB disk image takes minutes.

2. **Cost** — Storing disk images is expensive. Storing a JSON config is basically free.

3. **Flexibility** — You can restore to a different GPU pool, change the number of GPUs, or use a newer base image while keeping your data.

4. **Separation of concerns** — Stateless compute + stateful storage is the cloud-native pattern. It enables autoscaling, spot instances, and cost optimization.

5. **Immutable infrastructure** — Containers should be reproducible. Your environment should be defined in code (Dockerfile, requirements.txt), not captured in state.

## Common Gotchas

### Gotcha 1: "My storage shows 0% attached"

If you create a snapshot but the restore doesn't attach storage, check:
- Did the original pod actually have persistent storage attached?
- A snapshot of a pod without storage will restore without storage

### Gotcha 2: "My packages are gone"

This is expected. pip packages are in ephemeral storage. Solutions:
- Install to persistent storage (see Workflow 3 above)
- Use a deploy script that reinstalls packages
- Bake packages into a custom container image

### Gotcha 3: "Why is my storage still billing after termination?"

Persistent storage volumes exist independently. Terminating a pod doesn't delete the volume. You must explicitly delete the volume in the Storage tab if you no longer need it.

### Gotcha 4: "Restore failed: volume not found"

The volume might have been deleted, or is attached to another running pod (volumes can only attach to one pod at a time). Check the Storage tab.

## Best Practices

1. **Store valuable data in /data/shareXX/** — Models, datasets, checkpoints, code
2. **Keep a setup.sh script in persistent storage** — Reinstall pip packages, configure environment
3. **Use environment variables** — \`HF_HOME\`, \`TRANSFORMERS_CACHE\` point to persistent paths
4. **Delete unused volumes** — Storage bills hourly even when no pod is attached
5. **Name your snapshots descriptively** — "vllm-llama-3.1-8b-working" not "snapshot-1"

## Summary

\`\`\`
Snapshot ≠ VM snapshot
Snapshot = Config bookmark + Storage reference

Ephemeral (/home, /tmp) → Local SSD → Fast → DESTROYED on terminate
Persistent (/data/*)    → NFS volume → Slower → SURVIVES terminate

Best practice: Store everything important in /data/shareXX/
\`\`\`

GPU pod snapshots are a powerful feature once you understand what they actually do. They let you save your configuration and instantly restore to a known-good state — but your data strategy needs to account for the ephemeral vs persistent divide.

Put your important files in persistent storage, create snapshots of working configurations, and you'll never lose data to an unexpected termination again.
  `.trim(),
  author: {
    name: "GPU Cloud Team",
    role: "Co-founder",
  },
  publishedAt: "2025-02-05",
  readingTime: "12 min read",
  category: "Technical",
  featured: true,
};
