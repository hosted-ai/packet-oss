# SSH Access Guide

Connect securely to your GPU instances via SSH.

## Quick Start

1. Click **SSH Key** on your GPU card
2. Paste your public SSH key
3. Copy the SSH command shown
4. Connect from your terminal

```bash
ssh -p <port> ubuntu@<host>
```

## Setting Up SSH Keys

### Option 1: Use an Existing Key

If you already have an SSH key pair:

```bash
# Display your public key
cat ~/.ssh/id_rsa.pub
# or
cat ~/.ssh/id_ed25519.pub
```

Copy the output and paste it into the SSH Key modal.

### Option 2: Generate a New Key

```bash
# Generate a new ED25519 key (recommended)
ssh-keygen -t ed25519 -C "your_email@example.com"

# Or generate an RSA key
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Display the public key
cat ~/.ssh/id_ed25519.pub
```

### Key Format

Your public key should look like:

```
ssh-ed25519 AAAAC3NzaC1... your_email@example.com
```

or

```
ssh-rsa AAAAB3NzaC1yc2... your_email@example.com
```

## Connecting to Your GPU

### Basic Connection

```bash
ssh -p 30123 ubuntu@35.190.160.152
```

### With Identity File

If your key isn't in the default location:

```bash
ssh -p 30123 -i ~/.ssh/my_key ubuntu@35.190.160.152
```

### SSH Config (Recommended)

Add to `~/.ssh/config` for easier access:

```
Host my-gpu
    HostName 35.190.160.152
    Port 30123
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
```

Then connect with just:

```bash
ssh my-gpu
```

## File Transfer

### Using SCP

```bash
# Upload a file
scp -P 30123 local_file.txt ubuntu@35.190.160.152:/home/ubuntu/

# Download a file
scp -P 30123 ubuntu@35.190.160.152:/home/ubuntu/results.csv ./

# Upload a directory
scp -P 30123 -r ./my_project ubuntu@35.190.160.152:/home/ubuntu/
```

### Using rsync (Recommended for Large Transfers)

```bash
# Sync a directory
rsync -avz -e "ssh -p 30123" ./data/ ubuntu@35.190.160.152:/home/ubuntu/data/

# With progress
rsync -avz --progress -e "ssh -p 30123" ./model.pt ubuntu@35.190.160.152:/home/ubuntu/
```

### Using SFTP

```bash
sftp -P 30123 ubuntu@35.190.160.152
```

## Port Forwarding

### Forward a Remote Port to Local

Access a service running on your GPU locally:

```bash
# Forward GPU's port 8888 to your local port 8888
ssh -p 30123 -L 8888:localhost:8888 ubuntu@35.190.160.152
```

Then open `http://localhost:8888` in your browser.

### Common Use Cases

```bash
# Jupyter Notebook
ssh -p 30123 -L 8888:localhost:8888 ubuntu@35.190.160.152

# TensorBoard
ssh -p 30123 -L 6006:localhost:6006 ubuntu@35.190.160.152

# Multiple ports
ssh -p 30123 -L 8888:localhost:8888 -L 6006:localhost:6006 ubuntu@35.190.160.152
```

## Managing Multiple Keys

You can add multiple SSH keys to your account:

1. Go to **Settings** in the dashboard
2. Click **SSH Keys**
3. Add keys for different machines (work laptop, home desktop, etc.)

Each key can be given a name for easy identification.

## Troubleshooting

### Permission Denied

```
Permission denied (publickey)
```

**Solutions:**
- Ensure you added your **public** key (not private)
- Check the key was saved successfully
- Verify you're using the correct identity file: `ssh -v -p <port> ubuntu@<host>`

### Connection Refused

```
ssh: connect to host ... port ...: Connection refused
```

**Solutions:**
- Verify your GPU is in "Running" status
- Check the port number is correct
- Wait 30 seconds after starting a new instance

### Host Key Verification Failed

```
WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!
```

This can happen if you get a new GPU with the same IP. Remove the old key:

```bash
ssh-keygen -R "[35.190.160.152]:30123"
```

### Slow Connection

For better performance:

```bash
ssh -p 30123 -o Compression=yes ubuntu@35.190.160.152
```

Or add to your `~/.ssh/config`:

```
Host my-gpu
    Compression yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

## Security Best Practices

1. **Use ED25519 keys** - More secure and faster than RSA
2. **Protect your private key** - Never share it, set permissions to 600
3. **Use passphrases** - Add a passphrase when generating keys
4. **Rotate keys periodically** - Remove old keys you no longer use

```bash
# Set correct permissions
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

## VS Code Remote SSH

Connect VS Code directly to your GPU:

1. Install the "Remote - SSH" extension
2. Add your GPU to SSH config (see above)
3. Click the green remote icon in VS Code
4. Select "Connect to Host" → your GPU

This gives you a full IDE experience on your remote GPU.

## Need Help?

Contact us at [support@example.com](mailto:support@example.com)
