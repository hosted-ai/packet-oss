/**
 * Persistent Workspaces Deep Dive Blog Post
 *
 * @module blog/posts/persistent-workspaces-deep-dive
 */

import type { BlogPost } from "./types";

export const persistentWorkspacesDeepDive: BlogPost = {
  slug: "persistent-workspaces-deep-dive",
  title: "How Persistent Workspaces Actually Work (A Deep Dive)",
  excerpt:
    "GPU pods are ephemeral by default. Here's exactly how we make your files survive restarts — down to the bash scripts, init markers, and volume mounts.",
  content: `
# How Persistent Workspaces Actually Work

GPU pods are ephemeral. When your pod restarts, everything outside of mounted volumes is gone. Your pip packages, your config files, your half-finished training script — all wiped. This is a deep dive into how our Persistent Workspace feature solves this, and why it works the way it does.

## The Problem: Ephemeral Containers

Kubernetes pods run containers. Containers use layered filesystems (typically overlayfs) where the writable layer exists only for the container's lifetime. When the container stops, that layer is discarded.

This means:

- \`pip install torch\` — gone after restart
- Your \`.bashrc\` customizations — gone
- That Jupyter notebook you forgot to download — gone
- SSH keys you generated — gone

For GPU workloads, this is brutal. A single \`pip install torch torchvision torchaudio\` takes several minutes and downloads gigabytes. Doing that every time your pod cycles is not acceptable.

## The Solution: Volume Mounts + Init Scripts

The fix has two parts:

1. **Persistent volumes** — Kubernetes PersistentVolumeClaims (PVCs) that survive pod restarts
2. **Init scripts** — Bash scripts that wire the persistent storage into the right places on boot

When you launch a GPU on Packet with persistent storage enabled, we mount a PVC at \`/workspace\`. This directory persists across pod restarts. The question is: how do you make that useful?

## The Init Script, Line by Line

Here's the actual script that runs when you select "Persistent Workspace":

\`\`\`bash
#!/bin/bash
set -e

echo "=== Setting up Persistent Workspace ==="

# Check if /workspace exists (persistent storage mounted)
if [ ! -d "/workspace" ]; then
    echo "Warning: /workspace not found."
    exit 0
fi

# Create home backup location
mkdir -p /workspace/home

# Copy existing home contents if this is first run
if [ ! -f "/workspace/home/.packet-init" ]; then
    echo "First run - copying home to persistent storage..."
    cp -r $HOME/. /workspace/home/ 2>/dev/null || true
    touch /workspace/home/.packet-init
fi

# Persist PATH additions
if ! grep -q "packet-persist" /workspace/home/.bashrc 2>/dev/null; then
    echo '# packet-persist marker' >> /workspace/home/.bashrc
    echo 'export PATH="/workspace/bin:$PATH"' >> /workspace/home/.bashrc
    mkdir -p /workspace/bin
fi
\`\`\`

Let's break this down.

### Step 1: Guard Clause

\`\`\`bash
if [ ! -d "/workspace" ]; then
    echo "Warning: /workspace not found."
    exit 0
fi
\`\`\`

If there's no persistent volume mounted at \`/workspace\`, there's nothing to persist to. The script exits cleanly rather than failing. This is important because the script runs during pod boot — a hard failure here would prevent the pod from starting.

Note: \`exit 0\` not \`exit 1\`. We don't want to block pod startup just because storage wasn't attached. The user will see the warning in the startup logs.

### Step 2: The Init Marker Pattern

\`\`\`bash
if [ ! -f "/workspace/home/.packet-init" ]; then
    cp -r $HOME/. /workspace/home/ 2>/dev/null || true
    touch /workspace/home/.packet-init
fi
\`\`\`

This is the core trick. On the very first boot:

1. Copy the entire home directory into \`/workspace/home/\`
2. Write a marker file (\`.packet-init\`)

On subsequent boots, the marker file exists, so the copy is skipped. This means your persistent home directory keeps accumulating changes across restarts without being overwritten by the fresh container's defaults.

The \`2>/dev/null || true\` is defensive. Some files in \`$HOME\` might have restrictive permissions or be special (sockets, etc). We don't want \`cp\` failures to abort the script.

The \`cp -r $HOME/.\` pattern (note the dot) copies the *contents* of \`$HOME\` including hidden files (like \`.bashrc\`, \`.ssh/\`, etc.) into \`/workspace/home/\` without creating a nested directory.

### Step 3: PATH Persistence

\`\`\`bash
if ! grep -q "packet-persist" /workspace/home/.bashrc 2>/dev/null; then
    echo '# packet-persist marker' >> /workspace/home/.bashrc
    echo 'export PATH="/workspace/bin:$PATH"' >> /workspace/home/.bashrc
    mkdir -p /workspace/bin
fi
\`\`\`

This adds \`/workspace/bin\` to the PATH in the persisted \`.bashrc\`. The \`grep -q "packet-persist"\` check prevents duplicate entries across restarts (idempotency).

Why \`/workspace/bin\`? If you install binaries to this directory, they'll be available after restarts. For example:

\`\`\`bash
# Install something to the persistent bin directory
cp my-tool /workspace/bin/
chmod +x /workspace/bin/my-tool
# Available after restart because /workspace/bin is in PATH
\`\`\`

## The Full Dev Environment Variant

When you select "Full Dev Environment", the persistence logic is embedded alongside VS Code and Jupyter setup:

\`\`\`bash
# 1. Setup persistent workspace
if [ -d "/workspace" ]; then
    mkdir -p /workspace/home
    if [ ! -f "/workspace/home/.packet-init" ]; then
        cp -r $HOME/. /workspace/home/ 2>/dev/null || true
        touch /workspace/home/.packet-init
    fi
fi

# 2. Install VS Code (code-server)
curl -fsSL https://code-server.dev/install.sh | sh

# 3. Install Jupyter Lab
pip install --quiet jupyterlab numpy pandas matplotlib
\`\`\`

The workspace persistence runs first, then services are installed. Note that VS Code and Jupyter still get installed from scratch on each restart — only the workspace files persist, not the installed packages themselves.

## What Persists (and What Doesn't)

**Persists across restarts:**
- Files in \`/workspace/\`
- The home directory snapshot in \`/workspace/home/\`
- Anything you put in \`/workspace/bin/\`

**Does NOT persist:**
- System packages (\`apt-get install ...\`)
- pip packages (unless installed to \`/workspace\`)
- Systemd services / running processes
- Anything written to directories outside \`/workspace/\`

## Why Not Bind-Mount $HOME?

You might wonder: why not just mount the PVC directly at \`$HOME\`? Then everything would persist automatically.

There are a few reasons:

1. **Container images expect a populated \`$HOME\`** — CUDA images have specific dotfiles, conda configs, and environment setups in the home directory. Mounting an empty volume there would break things.

2. **First-boot bootstrapping** — The container needs to initialize \`$HOME\` with defaults before we can persist it. You can't mount a PVC and populate it atomically during container creation.

3. **Clean escape hatch** — If something goes wrong with the persisted home, you can simply delete \`/workspace/home/.packet-init\` and the next restart will re-copy the fresh defaults.

## Pro Tips

### Persist pip packages

\`\`\`bash
# Install to a persistent location
pip install --target=/workspace/pip-packages torch

# Add to your persistent bashrc
echo 'export PYTHONPATH="/workspace/pip-packages:$PYTHONPATH"' \\
  >> /workspace/home/.bashrc
\`\`\`

### Persist conda environments

\`\`\`bash
# Create conda env in persistent storage
conda create --prefix /workspace/envs/myenv python=3.11
conda activate /workspace/envs/myenv
\`\`\`

### Custom startup script with persistence

Write a script that installs from a requirements file stored in \`/workspace\`:

\`\`\`bash
#!/bin/bash
# Your custom startup script
if [ -f /workspace/requirements.txt ]; then
    pip install -r /workspace/requirements.txt
fi
if [ -f /workspace/setup.sh ]; then
    bash /workspace/setup.sh
fi
\`\`\`

Store your \`requirements.txt\` and \`setup.sh\` in \`/workspace/\` once, and they'll run on every boot automatically.

## The Architecture

Here's the full picture:

\`\`\`
┌──────────────────────────────────────┐
│          Kubernetes Pod              │
│                                      │
│  ┌──────────────────────────────┐    │
│  │   Container (ephemeral)      │    │
│  │                              │    │
│  │   $HOME (/root or /home/x)   │    │
│  │   └── .bashrc, .ssh/, etc.  │    │
│  │       (reset every restart) │    │
│  │                              │    │
│  │   /workspace (PVC mount) ────┼──┐ │
│  │   ├── home/                  │  │ │
│  │   │   ├── .packet-init       │  │ │
│  │   │   ├── .bashrc (persisted)│  │ │
│  │   │   └── your files...      │  │ │
│  │   ├── bin/                   │  │ │
│  │   └── your-project/          │  │ │
│  └──────────────────────────────┘  │ │
│                                    │ │
└────────────────────────────────────┘ │
                                       │
  ┌────────────────────────────────────┘
  │  PersistentVolumeClaim
  │  (survives pod restarts)
  └────────────────────────────────────
\`\`\`

## Summary

Persistent Workspaces are a simple mechanism:

1. Mount a PVC at \`/workspace\`
2. On first boot, copy \`$HOME\` into \`/workspace/home/\`
3. Mark it with \`.packet-init\` so subsequent boots don't overwrite
4. Add \`/workspace/bin\` to PATH for persistent binaries

It's not magic. It's a well-placed \`cp -r\`, a marker file, and a volume that outlives the container. Simple, predictable, and easy to debug when things go wrong.

Next time you launch a GPU, enable persistent storage and select "Persistent Workspace" or "Full Dev Environment". Your files will be there when you come back.
  `.trim(),
  author: {
    name: "GPU Cloud Team",
    role: "Co-founder",
  },
  publishedAt: "2025-01-27",
  readingTime: "7 min read",
  category: "Technical",
  featured: false,
};
