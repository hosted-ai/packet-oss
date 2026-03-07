/**
 * SkyPilot Integration Alpha Blog Post
 *
 * @module blog/posts/skypilot-integration-alpha
 */

import type { BlogPost } from "./types";

export const skypilotIntegrationAlpha: BlogPost = {
  slug: "skypilot-integration-alpha",
  title: "GPU Cloud + SkyPilot: Run ML Workloads with One Command (Alpha)",
  excerpt:
    "We've built a native SkyPilot integration for GPU Cloud. Launch GPU clusters, run distributed training, and deploy models using the same familiar SkyPilot interface—now with access to H100s, RTX 6000 Pros, and more. Alpha testers get $100 in free compute.",
  content: `
# GPU Cloud + SkyPilot: Run ML Workloads with One Command

**Status: Alpha — We're looking for testers. $500 in free GPU compute for everyone who helps us battle-test this.**

Today we're releasing something we've been working on for months: a native SkyPilot cloud provider for GPU Cloud.

If you've ever used SkyPilot, you know it's the best way to run ML workloads across clouds. One YAML file, one command, and your training job runs on whatever hardware is available and affordable—whether that's AWS, GCP, Azure, Lambda Labs, or a dozen other providers.

Now GPU Cloud is part of that ecosystem.

\`\`\`bash
# This just works now
sky launch --cloud packet --gpus H100:4 train.yaml
\`\`\`

## Why We Built This

We love SkyPilot. Our own team uses it internally. When you're running ML experiments, the last thing you want to think about is cloud provider APIs, instance provisioning, SSH key management, or startup scripts.

SkyPilot abstracts all of that away. You describe what you need—GPUs, memory, disk—and it figures out where to run it and how to get it there.

But SkyPilot's power comes from having options. The more clouds in the catalog, the better the optimizer works. More availability. Better pricing. Less lock-in.

GPU Cloud brings something different to that catalog:

- **Competitive pricing**: Efficient infrastructure means lower GPU prices
- **Direct hardware access**: No virtualization overhead, full CUDA capability
- **Flexible configurations**: 1x, 2x, 4x, or 8x GPU setups across multiple accelerator types
- **Instant availability**: No capacity constraints on most GPU types
- **Simple billing**: Pay by the hour, no minimum commitments

We wanted our users to access these benefits through the tools they already know. Hence: native SkyPilot support.

## What We Actually Built

This wasn't a weekend hack. We implemented a complete SkyPilot cloud provider from scratch, following the same patterns used by AWS, GCP, and the other first-class integrations.

### Full Cloud Provider Implementation

The integration includes:

**Cloud Abstraction Layer** (\`sky/clouds/packet.py\`)
- Region discovery and validation
- GPU catalog with real-time pricing
- Instance type mapping
- Credential management
- Resource optimization hints

**Provisioning Backend** (\`sky/provision/packet/\`)
- Instance lifecycle management (create, start, stop, terminate)
- SSH key injection and management
- Startup script execution
- Health checking and status polling
- Graceful error handling and retries

**Dynamic Catalog System** (\`sky/catalog/packet_catalog.py\`)
- Live pricing from GPU Cloud API
- Automatic GPU spec detection
- Multi-region support
- Accelerator filtering and matching

**API Integration** (\`sky/adaptors/packet.py\`)
- Lazy loading for minimal import overhead
- Connection pooling
- Rate limiting compliance
- Error normalization

## How It Works

### Installation

Install our SkyPilot fork (we're working on upstreaming this):

\`\`\`bash
pip install "skypilot[packet]"  # Contact us for alpha access
\`\`\`

### Configuration

Add your GPU Cloud credentials:

\`\`\`bash
# Get your API key from https://your-domain.com/account
sky config set packet.api_key YOUR_API_KEY
\`\`\`

Or set the environment variable:

\`\`\`bash
export PACKET_API_KEY=your_api_key
\`\`\`

### Verify Setup

\`\`\`bash
sky check packet
\`\`\`

You should see:

\`\`\`
Checking credentials for cloud: GPU Cloud...
  GPU Cloud: enabled
    Activated account: your@email.com
    Available GPUs: H100, H200, A100, RTX6000-Pro, RTX6000-Ada, L40S, RTX4090
\`\`\`

### Launch Your First Cluster

Create a simple task file:

\`\`\`yaml
# train.yaml
resources:
  cloud: packet
  accelerators: H100:1

setup: |
  pip install torch transformers accelerate

run: |
  python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
  python -c "import torch; print(f'GPU: {torch.cuda.get_device_name(0)}')"
\`\`\`

Launch it:

\`\`\`bash
sky launch -c my-cluster train.yaml
\`\`\`

That's it. SkyPilot handles everything: provisioning the instance, setting up SSH, running your setup script, executing your code, and giving you access to the cluster.

## Real-World Examples

### Fine-tuning Llama with QLoRA

\`\`\`yaml
# finetune-llama.yaml
name: llama-finetune

resources:
  cloud: packet
  accelerators: H100:1
  disk_size: 200

setup: |
  pip install torch transformers peft datasets accelerate bitsandbytes
  pip install trl

run: |
  python train.py \\
    --model_name meta-llama/Llama-3.1-8B \\
    --dataset_name your-dataset \\
    --output_dir ./outputs \\
    --per_device_train_batch_size 4 \\
    --gradient_accumulation_steps 4 \\
    --learning_rate 2e-4 \\
    --num_train_epochs 3 \\
    --lora_r 16 \\
    --lora_alpha 32
\`\`\`

### Distributed Training with DeepSpeed

\`\`\`yaml
# distributed-train.yaml
name: distributed-deepspeed

resources:
  cloud: packet
  accelerators: H100:8  # Full 8-GPU node
  disk_size: 500

num_nodes: 2  # Multi-node training

setup: |
  pip install torch deepspeed transformers accelerate

run: |
  deepspeed --num_gpus=8 --num_nodes=2 \\
    train.py \\
    --deepspeed ds_config.json \\
    --model_name bigscience/bloom-7b1 \\
    --per_device_train_batch_size 2 \\
    --gradient_accumulation_steps 8
\`\`\`

### Serving with vLLM

\`\`\`yaml
# serve-vllm.yaml
name: llm-server

resources:
  cloud: packet
  accelerators: RTX6000-Pro:1  # 96GB VRAM for large models
  ports: 8000

setup: |
  pip install vllm

run: |
  python -m vllm.entrypoints.openai.api_server \\
    --model meta-llama/Llama-3.1-70B \\
    --host 0.0.0.0 \\
    --port 8000 \\
    --tensor-parallel-size 1
\`\`\`

### Batch Inference Jobs

\`\`\`yaml
# batch-inference.yaml
name: batch-process

resources:
  cloud: packet
  accelerators: RTX4090:4  # Cost-effective for inference

file_mounts:
  /data:
    source: s3://your-bucket/input-data
    mode: COPY
  /outputs:
    source: s3://your-bucket/outputs
    mode: MOUNT

run: |
  python batch_inference.py \\
    --input_dir /data \\
    --output_dir /outputs \\
    --batch_size 32
\`\`\`

## SkyPilot Features That Work

The integration supports the full SkyPilot feature set:

### Cluster Management
\`\`\`bash
sky status              # View all clusters
sky ssh my-cluster      # SSH into cluster
sky exec my-cluster cmd # Run commands
sky stop my-cluster     # Stop (pause billing)
sky start my-cluster    # Resume
sky down my-cluster     # Terminate
\`\`\`

### Managed Jobs
\`\`\`bash
# Automatic recovery from preemptions
sky jobs launch train.yaml
sky jobs queue
sky jobs logs JOB_ID
\`\`\`

### Auto-stop
\`\`\`bash
# Automatically stop idle clusters
sky launch --idle-minutes-to-autostop 30 train.yaml
\`\`\`

### Multi-Cloud Fallback
\`\`\`yaml
# SkyPilot will try Packet first, fall back to others if unavailable
resources:
  accelerators: H100:4
  cloud: packet
  any_of:
    - cloud: packet
    - cloud: aws
    - cloud: gcp
\`\`\`

## Why Alpha?

We're calling this an alpha release because:

1. **Limited production testing**: We've tested extensively internally, but we need real-world workloads to find edge cases.

2. **API stability**: The GPU Cloud API may have minor changes as we refine the integration based on feedback.

3. **Feature completeness**: Some advanced SkyPilot features (like spot instances) aren't implemented yet.

4. **Documentation**: We're still writing comprehensive docs. The examples above are accurate, but there's more to cover.

We're confident in the core functionality—launching clusters, running jobs, managing instances—but we want to be transparent about where we are in the development cycle.

## Help Us Test: $100 Free Compute

Here's the deal: we need testers. Real workloads, real use cases, real feedback.

**Every alpha tester gets $100 in free GPU compute credits.**

Enough to run serious experiments, not just toy examples.

### What We're Looking For

- **Training workloads**: Does distributed training work smoothly? Any issues with checkpointing?
- **Inference serving**: How's the networking? Any latency issues?
- **Long-running jobs**: Stability over hours/days of continuous operation?
- **Edge cases**: Unusual configurations, large file transfers, specific framework requirements?
- **Documentation gaps**: What's confusing? What's missing?

### How to Join

1. **Sign up** at [your-domain.com](https://your-domain.com) if you haven't already
2. **Email us** at [support@your-domain.com](mailto:support@your-domain.com) with:
   - Your GPU Cloud account email
   - A brief description of your use case
   - What GPU types you're most interested in testing
3. **We'll add $100 credits** to your account within 24 hours
4. **Install the fork** and start experimenting
5. **Report issues** via email or on our GitHub when the upstream PR lands

No NDAs, no formal commitments. Just try it, break it, tell us what happened.

## Roadmap

Assuming the alpha goes well, here's what's coming:

**Q1 2025**
- Upstream PR to official SkyPilot repository
- Spot instance support (preemptible pricing)
- Auto-scaling for serving workloads

**Q2 2025**
- SkyServe integration for managed model serving
- Kubernetes cluster provisioning
- Reserved capacity pricing

**Ongoing**
- New GPU types as we add them (B200, GB200 on the horizon)
- Performance optimizations
- Extended region support

## The Technical Details

For those who want to dive deeper, here's how the integration actually works under the hood.

### Authentication Flow

When you run \`sky launch\`, the Packet adapter:
1. Reads your API key from config or environment
2. Validates the key against our API
3. Fetches your account info and available balance
4. Caches credentials for subsequent operations

### Instance Provisioning

The provisioning flow:
1. **Catalog lookup**: Find matching instance types for your GPU request
2. **Region selection**: Pick the best region based on availability and pricing
3. **API call**: Create the instance via GPU Cloud REST API
4. **SSH setup**: Inject your public key and wait for SSH availability
5. **Health check**: Verify instance is responsive and GPUs are detected
6. **Setup execution**: Run your setup script via SSH
7. **Handoff**: Return control to SkyPilot for job execution

### Catalog Synchronization

Our catalog stays fresh through:
1. **Static baseline**: Core GPU specs (VRAM, compute capability) are hardcoded
2. **Dynamic pricing**: Prices are fetched from our API on each catalog access
3. **Availability hints**: Instance availability is checked in real-time

### Error Handling

We've implemented comprehensive error handling for:
- API rate limits (automatic backoff and retry)
- Provisioning failures (graceful cleanup and reporting)
- Network timeouts (configurable timeouts with retries)
- Insufficient balance (clear error messages)
- Quota limits (transparent reporting)

## Source Code

The integration is open source. You can review the implementation, report issues, or contribute improvements:

The integration source will be published once the upstream SkyPilot PR is accepted. In the meantime, alpha testers receive access to the fork directly.

We welcome contributions, especially for:
- Bug fixes
- Documentation improvements
- Additional test coverage
- Performance optimizations

## Get Started

\`\`\`bash
# Install
pip install "skypilot[packet]"  # Contact us for alpha access

# Configure
export PACKET_API_KEY=your_api_key

# Verify
sky check packet

# Launch
sky launch --cloud packet --gpus H100:1 -c test-cluster -- nvidia-smi
\`\`\`

Questions? Feedback? Issues?
- Email: [support@your-domain.com](mailto:support@your-domain.com)

---

*GPU Cloud provides on-demand GPU compute for AI/ML workloads. H100s from $2.49/hr, RTX 4090s from $0.44/hr. No commitments, no markup, no complexity. [Get started](https://your-domain.com)*
  `.trim(),
  author: {
    name: "GPU Cloud Team",
    role: "Co-founder",
  },
  publishedAt: "2025-01-31",
  readingTime: "12 min read",
  category: "Announcements",
  featured: true,
};
