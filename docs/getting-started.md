# Getting Started with GPU Cloud Platform

Get your first GPU running in under 5 minutes.

## Prerequisites

- A GPU Cloud Platform account with an active subscription
- A payment method on file (credit card or prepaid balance)

## Step 1: Launch a GPU

1. From your dashboard, click **Launch GPU**
2. **Select GPU Type** - Choose from available GPU models (e.g., NVIDIA L4, A100)
3. **Container Size** - Select CPU/RAM allocation for your container
4. **Storage** (optional):
   - **Ephemeral Storage** - Fast temporary storage, cleared on restart
   - **Persistent Storage** - Data survives restarts, scaling, and reimaging
5. Click **Continue**

## Step 2: Configure Your Instance

1. **Instance Name** - Give your GPU a memorable name (e.g., "training-run-1")
2. **Number of GPUs** - Select 1-8 GPUs per instance
3. Review the **estimated cost** per hour
4. Click **Launch GPU**

Your GPU will begin provisioning. This typically takes 30-60 seconds.

## Step 3: Connect via SSH

Once your GPU shows "Running" status:

1. Click **SSH Key** on your GPU card
2. Add your public SSH key (or generate a new one)
3. Use the provided SSH command to connect:

```bash
ssh -p <port> ubuntu@<host>
```

## Step 4: Start Working

Your GPU instance comes with:

- Ubuntu 22.04 LTS
- NVIDIA drivers pre-installed
- CUDA toolkit ready to use
- Python 3.10+ with pip

### Quick Test

```bash
# Check GPU is available
nvidia-smi

# Test CUDA
python3 -c "import torch; print(torch.cuda.is_available())"
```

## Common Workflows

### Running a Training Job

```bash
# Clone your repository
git clone https://github.com/your/repo.git
cd repo

# Install dependencies
pip install -r requirements.txt

# Start training
python train.py
```

### Using Persistent Storage

If you added persistent storage, it's mounted at `/data/shareXX`:

```bash
# Store datasets and checkpoints
sudo cp -r ./data /data/shareXX/
sudo cp model_checkpoint.pt /data/shareXX/

# Data persists across restarts
```

### Exposing a Service

To make a web service (like Jupyter or an API) accessible:

1. Start your service on a port (e.g., 8888)
2. Click **Services** on your GPU card
3. Add the port to expose it publicly

See the [Service Exposure Guide](/dashboard/docs/service-exposure) for details.

## Managing Your GPU

| Action | Description |
|--------|-------------|
| **Stop** | Pause billing, preserve ephemeral data temporarily |
| **Start** | Resume a stopped instance |
| **Restart** | Reboot the container (clears ephemeral data) |
| **Terminate** | Delete the instance permanently |

## Cost Management

- GPUs are billed per hour while running
- Stopped instances don't incur GPU charges
- Persistent storage is billed continuously
- Check your balance in the sidebar

## Next Steps

- [Add Persistent Storage](/dashboard/docs/persistent-storage) - Keep data across restarts
- [Expose Services](/dashboard/docs/service-exposure) - Make ports accessible
- [Deploy HuggingFace Models](/dashboard/docs/huggingface-deployment) - 1-click model deployment
- [Use the API](/dashboard/docs/api) - Programmatic access

## Need Help?

Contact us at [support@example.com](mailto:support@example.com)
