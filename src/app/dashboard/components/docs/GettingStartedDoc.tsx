"use client";

export function GettingStartedDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>Getting Started with GPU Cloud</h1>
      <p className="lead">
        Get your first GPU running in minutes. This guide covers everything from account setup to running your first training job.
      </p>

      {/* Table of Contents */}
      <nav className="not-prose my-8 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">On this page</h4>
        <ul className="space-y-1.5 text-sm">
          <li><a href="#platform-overview" className="text-blue-600 dark:text-blue-400 hover:underline">Platform Overview</a></li>
          <li><a href="#prerequisites" className="text-blue-600 dark:text-blue-400 hover:underline">Prerequisites</a></li>
          <li><a href="#launch-gpu" className="text-blue-600 dark:text-blue-400 hover:underline">Step 1: Launch a GPU</a></li>
          <li><a href="#connect-gpu" className="text-blue-600 dark:text-blue-400 hover:underline">Step 2: Connect to Your GPU</a></li>
          <li><a href="#start-working" className="text-blue-600 dark:text-blue-400 hover:underline">Step 3: Start Working</a></li>
          <li><a href="#common-workflows" className="text-blue-600 dark:text-blue-400 hover:underline">Common Workflows</a></li>
          <li><a href="#managing-gpu" className="text-blue-600 dark:text-blue-400 hover:underline">Managing Your GPU</a></li>
          <li><a href="#cost-management" className="text-blue-600 dark:text-blue-400 hover:underline">Cost Management</a></li>
          <li><a href="#next-steps" className="text-blue-600 dark:text-blue-400 hover:underline">Next Steps</a></li>
          <li><a href="#troubleshooting" className="text-blue-600 dark:text-blue-400 hover:underline">Troubleshooting</a></li>
        </ul>
      </nav>

      {/* Platform Overview */}
      <h2 id="platform-overview">Platform Overview</h2>
      <p>
        GPU Cloud is a cloud GPU platform designed for AI/ML workloads. Whether you&apos;re training models,
        running inference, or deploying LLMs, we provide the infrastructure you need.
      </p>

      <h3>Key Features</h3>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>GPU Compute</strong></td>
            <td>NVIDIA A100, H100, RTX 4090 and more. Scale from 1-8 GPUs per instance.</td>
          </tr>
          <tr>
            <td><strong>HuggingFace Integration</strong></td>
            <td>One-click deployment of any HuggingFace model with vLLM inference server.</td>
          </tr>
          <tr>
            <td><strong>Persistent Storage</strong></td>
            <td>NFS-based storage that survives instance restarts. Perfect for datasets and checkpoints.</td>
          </tr>
          <tr>
            <td><strong>Service Exposure</strong></td>
            <td>Expose any port to the internet with a public URL. Run APIs, notebooks, or web apps.</td>
          </tr>
          <tr>
            <td><strong>Browser Terminal</strong></td>
            <td>Full shell access directly from your browser. No SSH setup required.</td>
          </tr>
        </tbody>
      </table>

      {/* Prerequisites */}
      <h2 id="prerequisites">Prerequisites</h2>
      <p>Before you begin, make sure you have:</p>
      <ul>
        <li>An account (<a href="/checkout">Sign up here</a> if you don&apos;t have one)</li>
        <li>Credits in your account (prepaid balance or subscription)</li>
        <li>A payment method on file</li>
      </ul>

      <div className="not-prose bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 my-6">
        <h4 className="text-blue-800 dark:text-blue-200 font-semibold mb-2 text-base">New User?</h4>
        <p className="text-blue-700 dark:text-blue-300 text-sm mb-0">
          New accounts get $10 free credits to try the platform. Add funds via the Billing tab when you need more.
        </p>
      </div>

      {/* Step 1: Launch a GPU */}
      <h2 id="launch-gpu">Step 1: Launch a GPU</h2>
      <ol>
        <li>From your dashboard, click <strong>Launch GPU</strong></li>
        <li>
          <strong>Select GPU Pool</strong> - Choose from available GPU types and regions.
          Popular options include:
          <ul>
            <li><strong>RTX 4090</strong> - Great for inference and smaller training jobs</li>
            <li><strong>A100 40GB</strong> - Ideal for training and large model inference</li>
            <li><strong>H100</strong> - Maximum performance for demanding workloads</li>
          </ul>
        </li>
        <li>
          <strong>Instance Type</strong> - Select CPU/RAM allocation for your container.
          More RAM is useful for data preprocessing.
        </li>
        <li>
          <strong>Storage</strong> (optional):
          <ul>
            <li><strong>Ephemeral Storage</strong> - Fast local NVMe, cleared on restart (default)</li>
            <li><strong>Persistent Storage</strong> - NFS-based, survives restarts. Choose 50GB-1TB.</li>
          </ul>
        </li>
        <li>
          <strong>GPU Count</strong> - Select 1-8 GPUs depending on your workload. Start with 1 for
          most tasks, scale up for distributed training.
        </li>
        <li>Click <strong>Launch GPU</strong></li>
      </ol>
      <p>Your GPU will begin provisioning. This typically takes 30-60 seconds.</p>

      {/* Step 2: Connect */}
      <h2 id="connect-gpu">Step 2: Connect to Your GPU</h2>
      <p>Once your GPU shows &quot;Running&quot; status, you have three options:</p>

      <h3>Option A: Browser Terminal (Easiest)</h3>
      <p>
        Click the <strong>Terminal</strong> icon on your GPU card to open a browser-based
        terminal directly in the dashboard. No setup required.
      </p>

      <h3>Option B: SSH with Key</h3>
      <ol>
        <li>Go to <strong>Account Settings</strong> and add your SSH public key</li>
        <li>Copy the SSH command from your GPU card</li>
        <li>Connect from your terminal:</li>
      </ol>
      <pre>
        <code>{`# Connect to your GPU instance
ssh -p <port> ubuntu@<host>

# Example
ssh -p 30123 ubuntu@35.190.160.152`}</code>
      </pre>

      <h3>Option C: SSH with Password</h3>
      <p>A password is shown on your GPU card. Click to reveal it:</p>
      <pre>
        <code>{`# Connect with password
ssh -p <port> ubuntu@<host>
# Enter the password when prompted`}</code>
      </pre>

      <div className="not-prose bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 my-6">
        <h4 className="text-amber-800 dark:text-amber-200 font-semibold mb-2 text-base">SSH Key Recommended</h4>
        <p className="text-amber-700 dark:text-amber-300 text-sm mb-0">
          For the best experience, add your SSH key in Account Settings. This enables passwordless
          authentication and VS Code Remote SSH integration.
        </p>
      </div>

      {/* Step 3: Start Working */}
      <h2 id="start-working">Step 3: Start Working</h2>
      <p>Your GPU instance comes pre-configured with:</p>
      <table>
        <thead>
          <tr>
            <th>Software</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Operating System</td>
            <td>Ubuntu 22.04 LTS</td>
          </tr>
          <tr>
            <td>NVIDIA Drivers</td>
            <td>Latest stable drivers</td>
          </tr>
          <tr>
            <td>CUDA Toolkit</td>
            <td>CUDA 12.x with cuDNN</td>
          </tr>
          <tr>
            <td>Python</td>
            <td>Python 3.10+ with pip</td>
          </tr>
          <tr>
            <td>Package Managers</td>
            <td>apt, pip, conda (miniconda available)</td>
          </tr>
        </tbody>
      </table>

      <h3>Quick Test: Verify GPU Access</h3>
      <pre>
        <code>{`# Check GPU is available and see memory/utilization
nvidia-smi

# Test CUDA with PyTorch
pip install torch
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0)}')"

# Test with TensorFlow
pip install tensorflow
python3 -c "import tensorflow as tf; print(f'GPUs: {tf.config.list_physical_devices(\"GPU\")}')"

# Check CUDA version
nvcc --version`}</code>
      </pre>

      {/* Common Workflows */}
      <h2 id="common-workflows">Common Workflows</h2>

      <h3>Training a Model</h3>
      <pre>
        <code>{`# Clone your repository
git clone https://github.com/your/repo.git
cd repo

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start training
python train.py --epochs 100 --batch-size 32

# Monitor GPU usage in another terminal
watch -n 1 nvidia-smi`}</code>
      </pre>

      <h3>Using Persistent Storage</h3>
      <p>
        If you selected persistent storage, it&apos;s mounted at <code>/data/shareXX</code>:
      </p>
      <pre>
        <code>{`# Check your mounted volumes
sudo df -h | grep data

# Store datasets (persists across restarts)
sudo cp -r ./data /data/shareXX/datasets/

# Store model checkpoints
sudo mkdir -p /data/shareXX/checkpoints
sudo cp model_checkpoint.pt /data/shareXX/checkpoints/

# Link to your project directory
sudo ln -s /data/shareXX/datasets ./data`}</code>
      </pre>

      <h3>Running Jupyter Notebook</h3>
      <pre>
        <code>{`# Install Jupyter
pip install jupyter

# Start Jupyter (accessible via port forwarding or service exposure)
jupyter notebook --ip 0.0.0.0 --port 8888 --no-browser

# Or use JupyterLab
pip install jupyterlab
jupyter lab --ip 0.0.0.0 --port 8888 --no-browser`}</code>
      </pre>
      <p>
        Then either use SSH port forwarding (<code>ssh -L 8888:localhost:8888 ...</code>) or
        expose port 8888 using the Service Exposure feature.
      </p>

      <h3>Exposing a Service</h3>
      <p>To make a web service accessible from the internet:</p>
      <ol>
        <li>
          Start your service on a port (e.g., <code>--host 0.0.0.0 --port 8000</code>)
        </li>
        <li>
          Click <strong>Expose Port</strong> in the Exposed Services section of your GPU card
        </li>
        <li>Enter the port number and a service name</li>
        <li>Copy the external URL provided (e.g., <code>https://abc123.example.com</code>)</li>
      </ol>

      <pre>
        <code>{`# Example: Expose a FastAPI server
pip install fastapi uvicorn
cat > app.py << 'EOF'
from fastapi import FastAPI
app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello from GPU Cloud GPU!"}
EOF

# Start on port 8000
uvicorn app:app --host 0.0.0.0 --port 8000`}</code>
      </pre>

      <h3>Deploying a HuggingFace Model</h3>
      <p>For quick model deployment, use the HuggingFace integration:</p>
      <ol>
        <li>Click <strong>HuggingFace</strong> in the sidebar</li>
        <li>Search for a model (e.g., &quot;Llama 3.1&quot;, &quot;Mistral&quot;, &quot;Qwen&quot;)</li>
        <li>Select your GPU configuration</li>
        <li>Click <strong>Deploy</strong></li>
      </ol>
      <p>
        In 5-10 minutes, you&apos;ll have an OpenAI-compatible API endpoint running vLLM.
        See the <strong>HuggingFace Deployment</strong> docs for details.
      </p>

      {/* Managing Your GPU */}
      <h2 id="managing-gpu">Managing Your GPU</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Description</th>
            <th>Billing Impact</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Stop</strong></td>
            <td>Pause the instance. State is preserved.</td>
            <td>GPU billing stops. Storage continues.</td>
          </tr>
          <tr>
            <td><strong>Start</strong></td>
            <td>Resume a stopped instance.</td>
            <td>GPU billing resumes.</td>
          </tr>
          <tr>
            <td><strong>Restart</strong></td>
            <td>Reboot the container.</td>
            <td>No change.</td>
          </tr>
          <tr>
            <td><strong>Scale</strong></td>
            <td>Change the number of GPUs.</td>
            <td>Billing adjusts to new GPU count.</td>
          </tr>
          <tr>
            <td><strong>Terminate</strong></td>
            <td>Delete the instance permanently.</td>
            <td>All charges stop. Data is deleted.</td>
          </tr>
        </tbody>
      </table>

      <div className="not-prose bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 my-6">
        <h4 className="text-red-800 dark:text-red-200 font-semibold mb-2 text-base">Warning: Terminate is Permanent</h4>
        <p className="text-red-700 dark:text-red-300 text-sm mb-0">
          Terminating an instance deletes all data including ephemeral storage.
          Make sure to save important files to persistent storage or download them first.
        </p>
      </div>

      {/* Cost Management */}
      <h2 id="cost-management">Cost Management</h2>
      <ul>
        <li><strong>GPUs are billed per hour</strong> while running (prorated by minute)</li>
        <li><strong>Stopped instances don&apos;t incur GPU charges</strong></li>
        <li><strong>Persistent storage is billed continuously</strong> while it exists</li>
        <li>Check your balance and usage in the <strong>Billing</strong> section</li>
      </ul>

      <h3>Quick Tips to Save Money</h3>
      <ol>
        <li><strong>Stop when not using</strong> - GPU billing pauses immediately</li>
        <li><strong>Right-size your GPU</strong> - Start small, scale up only if needed</li>
        <li><strong>Use ephemeral storage</strong> - Persistent storage has ongoing costs</li>
        <li><strong>Terminate when done</strong> - Delete instances you no longer need</li>
        <li><strong>Monitor usage</strong> - Check the Billing tab regularly</li>
      </ol>

      {/* Next Steps */}
      <h2 id="next-steps">Next Steps</h2>
      <p>Now that you&apos;re set up, explore these features:</p>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Description</th>
            <th>Documentation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>HuggingFace Deployment</strong></td>
            <td>One-click deployment of any HuggingFace model</td>
            <td><a href="?tab=huggingface">HuggingFace Docs</a></td>
          </tr>
          <tr>
            <td><strong>OpenAI Gateway</strong></td>
            <td>Use your models with OpenAI SDKs and tools</td>
            <td><a href="?tab=openai-api">OpenAI Gateway Docs</a></td>
          </tr>
          <tr>
            <td><strong>SSH Access</strong></td>
            <td>Advanced SSH configuration and VS Code Remote</td>
            <td><a href="?tab=ssh">SSH Docs</a></td>
          </tr>
          <tr>
            <td><strong>Service Exposure</strong></td>
            <td>Make ports publicly accessible</td>
            <td><a href="?tab=service-exposure">Service Exposure Docs</a></td>
          </tr>
        </tbody>
      </table>

      {/* Troubleshooting */}
      <h2 id="troubleshooting">Troubleshooting</h2>

      <h3>GPU Not Launching</h3>
      <ul>
        <li><strong>Insufficient balance</strong>: Add funds in the Billing section</li>
        <li><strong>No availability</strong>: Try a different GPU pool or region</li>
        <li><strong>Stuck in &quot;Pending&quot;</strong>: Wait 2-3 minutes, then try terminating and relaunching</li>
      </ul>

      <h3>Can&apos;t Connect via SSH</h3>
      <ul>
        <li><strong>Connection refused</strong>: Wait 30 seconds after instance shows &quot;Running&quot;</li>
        <li><strong>Permission denied</strong>: Verify your SSH key is added in Account Settings</li>
        <li><strong>Host key changed</strong>: Run <code>ssh-keygen -R &quot;[host]:port&quot;</code></li>
      </ul>

      <h3>CUDA Not Working</h3>
      <pre>
        <code>{`# Check NVIDIA drivers
nvidia-smi

# If drivers not loaded, try:
sudo nvidia-smi

# Check CUDA installation
nvcc --version

# Test PyTorch CUDA
python3 -c "import torch; print(torch.cuda.is_available())"

# If False, reinstall PyTorch with CUDA support:
pip install torch --index-url https://download.pytorch.org/whl/cu121`}</code>
      </pre>

      <h3>Out of GPU Memory</h3>
      <ul>
        <li><strong>Reduce batch size</strong>: Lower <code>--batch-size</code> in your training script</li>
        <li><strong>Enable gradient checkpointing</strong>: Trade compute for memory</li>
        <li><strong>Use mixed precision</strong>: Add <code>--fp16</code> or <code>--bf16</code> flags</li>
        <li><strong>Scale up GPUs</strong>: Use the Scale feature to add more GPUs</li>
        <li><strong>Try a smaller model</strong>: Consider a quantized version</li>
      </ul>

      <h3>Slow Performance</h3>
      <ul>
        <li><strong>Check GPU utilization</strong>: Run <code>nvidia-smi</code> - should be near 100%</li>
        <li><strong>Enable DataLoader workers</strong>: Add <code>num_workers=4</code> to your DataLoader</li>
        <li><strong>Use persistent storage wisely</strong>: It&apos;s slower than local NVMe for random access</li>
        <li><strong>Pin memory</strong>: Add <code>pin_memory=True</code> to DataLoader</li>
      </ul>

      {/* Need Help */}
      <h2>Need Help?</h2>
      <p>
        Contact us at <a href="mailto:support@example.com">support@example.com</a> or
        use the <strong>Support</strong> tab in your dashboard for faster response.
      </p>
    </div>
  );
}
