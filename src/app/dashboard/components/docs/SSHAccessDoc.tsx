"use client";

export function SSHAccessDoc() {
  return (
    <div className="prose prose-zinc max-w-none">
      <h1>SSH Access Guide</h1>
      <p className="lead">Connect securely to your GPU instances via SSH or browser terminal.</p>

      <h2>Connection Methods</h2>
      <p>You have two ways to access your GPU:</p>
      <ul>
        <li><strong>Browser Terminal</strong> - Click the terminal icon on your GPU card for instant access</li>
        <li><strong>SSH</strong> - Connect from your local terminal using SSH keys or password</li>
      </ul>

      <h2>Browser Terminal</h2>
      <p>The simplest way to access your GPU:</p>
      <ol>
        <li>Find your running GPU in the dashboard</li>
        <li>Click the <strong>Terminal</strong> icon</li>
        <li>A browser-based terminal opens with full shell access</li>
      </ol>
      <p>No setup required. Works immediately when your GPU is running.</p>

      <h2>SSH Access</h2>

      <h3>Quick Start</h3>
      <ol>
        <li>Go to <strong>Account Settings</strong> → <strong>SSH Keys</strong></li>
        <li>Add your public SSH key</li>
        <li>Copy the SSH command from your GPU card</li>
        <li>Connect from your terminal</li>
      </ol>
      <pre><code>ssh -p &lt;port&gt; ubuntu@&lt;host&gt;</code></pre>

      <h3>Using Password Authentication</h3>
      <p>Each GPU instance also has a password shown on the GPU card. You can use this if you prefer not to set up SSH keys:</p>
      <ol>
        <li>Click to reveal the password on your GPU card</li>
        <li>Copy the SSH command</li>
        <li>Enter the password when prompted</li>
      </ol>

      <h2>Setting Up SSH Keys</h2>

      <h3>Use an Existing Key</h3>
      <p>If you already have an SSH key pair:</p>
      <pre><code>{`# Display your public key
cat ~/.ssh/id_rsa.pub
# or
cat ~/.ssh/id_ed25519.pub`}</code></pre>
      <p>Copy the output and paste it in Account Settings → SSH Keys.</p>

      <h3>Generate a New Key</h3>
      <pre><code>{`# Generate a new ED25519 key (recommended)
ssh-keygen -t ed25519 -C "your_email@example.com"

# Or generate an RSA key
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Display the public key
cat ~/.ssh/id_ed25519.pub`}</code></pre>

      <h3>Key Format</h3>
      <p>Your public key should look like:</p>
      <pre><code>ssh-ed25519 AAAAC3NzaC1... your_email@example.com</code></pre>
      <p>or</p>
      <pre><code>ssh-rsa AAAAB3NzaC1yc2... your_email@example.com</code></pre>

      <h3>Key Limits</h3>
      <p>You can add up to <strong>10 SSH keys</strong> per account. Each key is identified by its fingerprint.</p>

      <h2>SSH Config (Recommended)</h2>
      <p>Add to <code>~/.ssh/config</code> for easier access:</p>
      <pre><code>{`Host my-gpu
    HostName 35.190.160.152
    Port 30123
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519`}</code></pre>
      <p>Then connect with just:</p>
      <pre><code>ssh my-gpu</code></pre>

      <h2>File Transfer</h2>

      <h3>Using SCP</h3>
      <pre><code>{`# Upload a file
scp -P 30123 local_file.txt ubuntu@35.190.160.152:/home/ubuntu/

# Download a file
scp -P 30123 ubuntu@35.190.160.152:/home/ubuntu/results.csv ./

# Upload a directory
scp -P 30123 -r ./my_project ubuntu@35.190.160.152:/home/ubuntu/`}</code></pre>

      <h3>Using rsync (Recommended for Large Transfers)</h3>
      <pre><code>{`# Sync a directory
rsync -avz -e "ssh -p 30123" ./data/ ubuntu@35.190.160.152:/home/ubuntu/data/

# With progress
rsync -avz --progress -e "ssh -p 30123" ./model.pt ubuntu@35.190.160.152:/home/ubuntu/`}</code></pre>

      <h3>Using SFTP</h3>
      <pre><code>sftp -P 30123 ubuntu@35.190.160.152</code></pre>

      <h2>Port Forwarding</h2>

      <h3>Forward a Remote Port to Local</h3>
      <p>Access a service running on your GPU locally:</p>
      <pre><code>{`# Forward GPU's port 8888 to your local port 8888
ssh -p 30123 -L 8888:localhost:8888 ubuntu@35.190.160.152`}</code></pre>
      <p>Then open <code>http://localhost:8888</code> in your browser.</p>

      <h3>Common Use Cases</h3>
      <pre><code>{`# Jupyter Notebook
ssh -p 30123 -L 8888:localhost:8888 ubuntu@35.190.160.152

# TensorBoard
ssh -p 30123 -L 6006:localhost:6006 ubuntu@35.190.160.152

# Multiple ports
ssh -p 30123 -L 8888:localhost:8888 -L 6006:localhost:6006 ubuntu@35.190.160.152`}</code></pre>

      <p><strong>Tip:</strong> You can also use the Service Exposure feature to make ports publicly accessible without SSH tunneling.</p>

      <h2>Troubleshooting</h2>

      <h3>Permission Denied</h3>
      <pre><code>Permission denied (publickey)</code></pre>
      <p><strong>Solutions:</strong></p>
      <ul>
        <li>Ensure you added your <strong>public</strong> key (not private)</li>
        <li>Check the key was saved in Account Settings</li>
        <li>Try using the password authentication instead</li>
        <li>Verify you&apos;re using the correct identity file: <code>ssh -v -p &lt;port&gt; ubuntu@&lt;host&gt;</code></li>
      </ul>

      <h3>Connection Refused</h3>
      <pre><code>ssh: connect to host ... port ...: Connection refused</code></pre>
      <p><strong>Solutions:</strong></p>
      <ul>
        <li>Verify your GPU is in &quot;Running&quot; status</li>
        <li>Check the port number is correct</li>
        <li>Wait 30 seconds after starting a new instance</li>
      </ul>

      <h3>Host Key Verification Failed</h3>
      <pre><code>WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!</code></pre>
      <p>This can happen if you get a new GPU with the same IP. Remove the old key:</p>
      <pre><code>ssh-keygen -R &quot;[35.190.160.152]:30123&quot;</code></pre>

      <h2>VS Code Remote SSH</h2>
      <p>Connect VS Code directly to your GPU:</p>
      <ol>
        <li>Install the &quot;Remote - SSH&quot; extension</li>
        <li>Add your GPU to SSH config (see above)</li>
        <li>Click the green remote icon in VS Code</li>
        <li>Select &quot;Connect to Host&quot; → your GPU</li>
      </ol>
      <p>This gives you a full IDE experience on your remote GPU.</p>

      <h2>Security Best Practices</h2>
      <ol>
        <li><strong>Use ED25519 keys</strong> - More secure and faster than RSA</li>
        <li><strong>Protect your private key</strong> - Never share it, set permissions to 600</li>
        <li><strong>Use passphrases</strong> - Add a passphrase when generating keys</li>
        <li><strong>Remove unused keys</strong> - Delete keys you no longer use from Account Settings</li>
      </ol>
      <pre><code>{`# Set correct permissions
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub`}</code></pre>

      <h2>Need Help?</h2>
      <p>Contact us at <a href="mailto:support@example.com">support@example.com</a></p>
    </div>
  );
}
