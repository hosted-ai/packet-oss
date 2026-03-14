"use client";

export function WorkspaceDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>Persistent Workspace Setup</h1>
      <p className="lead">
        Configure your GPU instance to persist your home directory, packages, and configurations across restarts.
      </p>

      <h2>Overview</h2>
      <p>
        By default, GPU instances use ephemeral storage - any files, packages, or configurations
        in your home directory are lost when the instance restarts. This guide shows you how to
        set up a persistent workspace so your environment survives restarts.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>A running GPU instance with persistent storage attached</li>
        <li>SSH or terminal access to your instance</li>
      </ul>

      <h2>Quick Setup</h2>
      <p>Run this one-time setup script to configure workspace persistence:</p>
      <pre>
        <code>{`#!/bin/bash
# Persistent Workspace Setup Script

# Set your persistent storage mount (adjust to your volume name)
STORAGE_PATH="/data/shareXX"

# Create workspace directories on persistent storage
sudo mkdir -p $STORAGE_PATH/workspace/{home,pip,conda,cache}

# Create a setup script that runs on login
sudo cat > $STORAGE_PATH/workspace/init.sh << 'EOF'
#!/bin/bash
# Link home directories to persistent storage
STORAGE_PATH="/data/shareXX"

# Create symlinks for common directories
ln -sfn $STORAGE_PATH/workspace/pip ~/.local
ln -sfn $STORAGE_PATH/workspace/cache ~/.cache

# Set environment variables
export PIP_CACHE_DIR="$STORAGE_PATH/workspace/pip"
export HF_HOME="$STORAGE_PATH/workspace/cache/huggingface"
export TRANSFORMERS_CACHE="$HF_HOME"

# Source any custom bashrc
if [ -f "$STORAGE_PATH/workspace/home/.bashrc_custom" ]; then
  source $STORAGE_PATH/workspace/home/.bashrc_custom
fi

echo "Workspace loaded from persistent storage"
EOF

sudo chmod +x $STORAGE_PATH/workspace/init.sh

# Add to bashrc for automatic loading
echo 'source /data/shareXX/workspace/init.sh' >> ~/.bashrc

echo "Setup complete! Your workspace will now persist across restarts."`}</code>
      </pre>

      <h2>What Gets Persisted</h2>
      <table>
        <thead>
          <tr>
            <th>Directory</th>
            <th>Purpose</th>
            <th>Persisted</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>~/.local</code></td>
            <td>pip packages, local binaries</td>
            <td>Yes (symlinked)</td>
          </tr>
          <tr>
            <td><code>~/.cache</code></td>
            <td>pip cache, HuggingFace models</td>
            <td>Yes (symlinked)</td>
          </tr>
          <tr>
            <td><code>$STORAGE_PATH/workspace</code></td>
            <td>Your projects, scripts, data</td>
            <td>Yes (on NFS)</td>
          </tr>
          <tr>
            <td><code>/home/ubuntu</code></td>
            <td>Home directory (system files)</td>
            <td>No (ephemeral)</td>
          </tr>
        </tbody>
      </table>

      <h2>Recommended Workflow</h2>

      <h3>Store Projects on Persistent Storage</h3>
      <pre>
        <code>{`# Clone repos directly to persistent storage
cd /data/shareXX/workspace
sudo git clone https://github.com/your/project.git

# Create a symlink in home for convenience
sudo ln -s /data/shareXX/workspace/project ~/project`}</code>
      </pre>

      <h3>Install Packages with Persistence</h3>
      <pre>
        <code>{`# Install packages (will use persisted pip cache)
sudo pip install torch transformers

# Or use a requirements file from persistent storage
sudo pip install -r /data/shareXX/workspace/project/requirements.txt`}</code>
      </pre>

      <h3>Store Environment Variables</h3>
      <pre>
        <code>{`# Add custom environment variables
sudo cat >> /data/shareXX/workspace/home/.bashrc_custom << 'EOF'
export MY_API_KEY="your-key-here"
export PROJECT_ROOT="/data/shareXX/workspace/project"
alias project="cd $PROJECT_ROOT"
EOF`}</code>
      </pre>

      <h2>After Restart</h2>
      <p>When your instance restarts:</p>
      <ol>
        <li>Persistent storage is automatically remounted at <code>/data/shareXX</code></li>
        <li>Your <code>.bashrc</code> sources the init script (you need to re-run the setup once on fresh instances)</li>
        <li>Symlinks restore access to your pip packages and caches</li>
        <li>Your projects and data are immediately available</li>
      </ol>

      <div style={{
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "16px",
      }}>
        <p style={{ margin: 0, fontWeight: 600, color: "#92400e" }}>Important Note</p>
        <p style={{ margin: "8px 0 0 0", fontSize: "14px", color: "#92400e" }}>
          If you terminate your instance (not just restart), you&apos;ll need to re-run
          the setup script on your new instance. The data on persistent storage remains,
          but the symlinks and bashrc entries need to be recreated.
        </p>
      </div>

      <h2>Pro Tips</h2>

      <h3>Use a Setup Script Repository</h3>
      <pre>
        <code>{`# Store your setup script on GitHub
# Then on any new instance:
curl -sSL https://raw.githubusercontent.com/you/dotfiles/main/setup.sh | bash`}</code>
      </pre>

      <h3>Docker/Container Workflows</h3>
      <p>If you&apos;re using Docker:</p>
      <pre>
        <code>{`# Mount persistent storage into containers
sudo docker run -v /data/shareXX:/data -it your-image`}</code>
      </pre>

      <h3>Conda Environments</h3>
      <pre>
        <code>{`# Store conda environments on persistent storage
sudo mkdir -p /data/shareXX/workspace/conda/envs
sudo conda config --prepend envs_dirs /data/shareXX/workspace/conda/envs

# Create environment (persisted automatically)
sudo conda create -n myenv python=3.10`}</code>
      </pre>

      <h2>Troubleshooting</h2>

      <h3>Packages not found after restart</h3>
      <p>Ensure your init script is being sourced:</p>
      <pre>
        <code>{`# Check if init script exists
cat /data/shareXX/workspace/init.sh

# Manually source it
source /data/shareXX/workspace/init.sh

# Verify symlinks
ls -la ~/.local`}</code>
      </pre>

      <h3>Permission errors</h3>
      <pre>
        <code>{`# Fix ownership
sudo chown -R $USER:$USER /data/shareXX/workspace`}</code>
      </pre>

      <h2>Need Help?</h2>
      <p>
        Contact us at{" "}
        our support team via the <strong>Support</strong> tab
      </p>
    </div>
  );
}
