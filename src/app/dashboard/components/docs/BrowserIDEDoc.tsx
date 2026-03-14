"use client";

export function BrowserIDEDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>Browser-Based IDEs</h1>
      <p className="lead">
        Access Jupyter Lab, VS Code, and other development tools directly in your browser.
      </p>

      <h2>Overview</h2>
      <p>
        Instead of using SSH, you can run browser-based development environments on your
        GPU instance. This guide covers setting up:
      </p>
      <ul>
        <li><strong>VS Code (code-server)</strong> - Full VS Code in your browser</li>
        <li><strong>Jupyter Lab</strong> - Interactive notebooks with GPU support</li>
        <li><strong>JupyterHub</strong> - Multi-user notebook environment</li>
      </ul>

      <h2>VS Code in Browser (code-server)</h2>
      <p>
        <a href="https://github.com/coder/code-server" target="_blank" rel="noopener noreferrer">code-server</a>{" "}
        runs VS Code as a web application, giving you the full VS Code experience in your browser.
      </p>

      <h3>Installation</h3>
      <pre>
        <code>{`# Install code-server (one-liner)
curl -fsSL https://code-server.dev/install.sh | sh

# Or with specific version
curl -fsSL https://code-server.dev/install.sh | sh -s -- --version 4.20.0`}</code>
      </pre>

      <h3>Running code-server</h3>
      <pre>
        <code>{`# Start code-server on port 8080
code-server --bind-addr 0.0.0.0:8080 --auth none

# Or with password authentication
export PASSWORD="your-secure-password"
code-server --bind-addr 0.0.0.0:8080 --auth password`}</code>
      </pre>

      <h3>Running in Background</h3>
      <pre>
        <code>{`# Using nohup
nohup code-server --bind-addr 0.0.0.0:8080 --auth none &

# Using screen
screen -dmS code code-server --bind-addr 0.0.0.0:8080 --auth none

# Check if running
ps aux | grep code-server`}</code>
      </pre>

      <h3>Expose to Internet</h3>
      <ol>
        <li>In your GPU card, click <strong>Expose Port</strong></li>
        <li>Enter port <code>8080</code> and name it &quot;VS Code&quot;</li>
        <li>Copy the external URL and open in your browser</li>
      </ol>

      <h2>Jupyter Lab</h2>
      <p>
        Jupyter Lab provides an interactive development environment for notebooks,
        code, and data - with full GPU access for ML workloads.
      </p>

      <h3>Installation</h3>
      <pre>
        <code>{`# Install Jupyter Lab
pip install jupyterlab

# With ML packages
pip install jupyterlab torch torchvision transformers`}</code>
      </pre>

      <h3>Running Jupyter Lab</h3>
      <pre>
        <code>{`# Start Jupyter Lab (accessible from any IP)
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root

# With custom token (recommended)
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='your-token'

# Without authentication (not recommended for production)
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token=''`}</code>
      </pre>

      <h3>Running in Background</h3>
      <pre>
        <code>{`# Using nohup
nohup jupyter lab --ip=0.0.0.0 --port=8888 --no-browser > jupyter.log 2>&1 &

# Using screen
screen -dmS jupyter jupyter lab --ip=0.0.0.0 --port=8888 --no-browser`}</code>
      </pre>

      <h3>Expose to Internet</h3>
      <ol>
        <li>In your GPU card, click <strong>Expose Port</strong></li>
        <li>Enter port <code>8888</code> and name it &quot;Jupyter&quot;</li>
        <li>Copy the external URL</li>
        <li>Add your token to the URL: <code>?token=your-token</code></li>
      </ol>

      <h2>GPU Access in Notebooks</h2>
      <p>Your GPU is automatically available in Jupyter notebooks:</p>
      <pre>
        <code>{`# Check GPU availability
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"GPU: {torch.cuda.get_device_name(0)}")

# Use GPU for training
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = model.to(device)`}</code>
      </pre>

      <h2>Recommended Setup</h2>
      <p>For the best development experience, we recommend this setup:</p>

      <h3>1. Create a startup script</h3>
      <pre>
        <code>{`# Create startup script on persistent storage
sudo cat > /data/shareXX/start-ide.sh << 'EOF'
#!/bin/bash

# Kill any existing processes
pkill -f code-server || true
pkill -f jupyter || true
sleep 2

# Start code-server
nohup code-server --bind-addr 0.0.0.0:8080 --auth none > /tmp/code-server.log 2>&1 &
echo "code-server started on port 8080"

# Start Jupyter Lab
nohup jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='your-token' > /tmp/jupyter.log 2>&1 &
echo "Jupyter Lab started on port 8888"

echo "IDEs ready! Expose ports 8080 and 8888 to access."
EOF
sudo chmod +x /data/shareXX/start-ide.sh`}</code>
      </pre>

      <h3>2. Run on startup</h3>
      <pre>
        <code>{`# Add to your workspace init script
sudo echo '/data/shareXX/start-ide.sh' >> /data/shareXX/workspace/init.sh`}</code>
      </pre>

      <h2>VS Code Extensions</h2>
      <p>Install extensions for Python/ML development:</p>
      <pre>
        <code>{`# Through code-server CLI
code-server --install-extension ms-python.python
code-server --install-extension ms-toolsai.jupyter
code-server --install-extension GitHub.copilot

# Or through the UI: Extensions panel (Ctrl+Shift+X)`}</code>
      </pre>

      <h2>Jupyter Extensions</h2>
      <pre>
        <code>{`# Useful Jupyter Lab extensions
pip install jupyterlab-git
pip install jupyterlab-lsp
pip install jupyterlab-code-formatter

# Rebuild JupyterLab to activate extensions
jupyter lab build`}</code>
      </pre>

      <h2>Security Considerations</h2>
      <ul>
        <li>
          <strong>Always use authentication</strong> - Set a strong password or token
        </li>
        <li>
          <strong>Use HTTPS</strong> - The exposed service URL includes HTTPS
        </li>
        <li>
          <strong>Firewall rules</strong> - Services are only accessible via the exposed port
        </li>
        <li>
          <strong>Session timeout</strong> - Consider using token-based auth with expiry
        </li>
      </ul>

      <h2>Troubleshooting</h2>

      <h3>Service not accessible</h3>
      <pre>
        <code>{`# Check if service is running
ps aux | grep -E "code-server|jupyter"

# Check logs
tail -f /tmp/code-server.log
tail -f /tmp/jupyter.log

# Verify port is listening
netstat -tlnp | grep -E "8080|8888"`}</code>
      </pre>

      <h3>Connection refused</h3>
      <ul>
        <li>Ensure you&apos;ve exposed the correct port in the dashboard</li>
        <li>Check that the service is bound to <code>0.0.0.0</code> (not <code>127.0.0.1</code>)</li>
        <li>Verify the pod is in &quot;Running&quot; status</li>
      </ul>

      <h3>Jupyter kernel dies</h3>
      <pre>
        <code>{`# Check GPU memory
nvidia-smi

# Kill stuck processes
sudo fuser -k 8888/tcp

# Restart Jupyter
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser`}</code>
      </pre>

      <h2>Alternative IDEs</h2>
      <ul>
        <li>
          <strong>OpenVSCode Server</strong> - Another VS Code web option from GitPod
        </li>
        <li>
          <strong>Theia</strong> - VS Code-like IDE with more flexibility
        </li>
        <li>
          <strong>JupyterHub</strong> - Multi-user Jupyter deployment
        </li>
      </ul>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        our support team via the <strong>Support</strong> tab
      </p>
    </div>
  );
}
