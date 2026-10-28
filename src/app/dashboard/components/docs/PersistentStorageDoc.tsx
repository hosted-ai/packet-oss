"use client";

export function PersistentStorageDoc() {
  return (
    <div>
      <p className="lead">Keep your data safe across restarts, stop/start cycles, and pod termination.</p>

      <h2>Overview</h2>
      <p>
        Persistent storage allows your data to survive pod restarts, stop/start
        cycles, and even pod termination. Unlike local ephemeral storage (which
        is lost when a pod is terminated), persistent storage uses
        network-attached NFS volumes that exist independently of your pods.
      </p>

      <h3>Key Features</h3>
      <ul>
        <li>
          <strong>Survives Restarts</strong>: Data persists when pods are
          restarted
        </li>
        <li>
          <strong>Survives Termination</strong>: Volumes are independent and can
          be attached to new pods
        </li>
        <li>
          <strong>NFS-Based</strong>: Uses network file system for reliability
        </li>
        <li>
          <strong>Automatic Mounting</strong>: Volumes are automatically mounted
          at <code>/data/shareXX</code>
        </li>
      </ul>

      <h2>Adding Persistent Storage</h2>

      <h3>At Launch Time</h3>
      <p>When launching a new GPU pod:</p>
      <ol>
        <li>Click <strong>Launch GPU</strong></li>
        <li>Select your GPU type, product, and region</li>
        <li>Under <strong>Shared Storage</strong>, choose one of:
          <ul>
            <li><strong>None</strong>: Root disk only. It survives reboots, but is lost when the instance is terminated</li>
            <li><strong>Create new volume</strong>: Pick a size; the volume is created and attached automatically</li>
            <li><strong>Use existing volume</strong>: Re-attach a volume you already own in that region (preserves your data)</li>
          </ul>
        </li>
        <li>Click <strong>Launch GPU</strong></li>
      </ol>

      <h3>To an Existing Instance</h3>
      <p>You can add persistent storage to a running instance:</p>
      <ol>
        <li>Find your GPU card in the dashboard</li>
        <li>Click <strong>Storage</strong> on the card</li>
        <li>Attach an existing available volume, or create a new one from the listed sizes</li>
        <li>Confirm the addition</li>
      </ol>
      <p>
        <strong>Note:</strong> Attaching storage to a running GPU briefly
        restarts the pod. Data on the persistent volume is unaffected.
      </p>

      <h2>Using Your Storage</h2>

      <h3>Accessing the Mount</h3>
      <p>Once your pod is running, persistent storage is mounted at:</p>
      <pre>
        <code>/data/shareXX/</code>
      </pre>
      <p>Verify the mount:</p>
      <pre>
        <code>{`# List mounted volumes
ls -la /data/

# Check disk usage
df -h | grep data`}</code>
      </pre>

      <h3>Common Workflows</h3>

      <h4>Storing HuggingFace Models</h4>
      <pre>
        <code>{`# Set HuggingFace cache to persistent storage
export HF_HOME=/data/shareXX/hf-cache

# Models will now be cached to persistent storage
python -c "from transformers import AutoModel; AutoModel.from_pretrained('bert-base-uncased')"`}</code>
      </pre>

      <h4>Storing Training Checkpoints</h4>
      <pre>
        <code>{`import torch

# Save checkpoints to persistent storage
checkpoint_dir = "/data/shareXX/checkpoints"
torch.save(model.state_dict(), f"{checkpoint_dir}/model_epoch_{epoch}.pt")`}</code>
      </pre>

      <h4>Using with vLLM</h4>
      <pre>
        <code>{`# Run vLLM with model cache on persistent storage
export HF_HOME=/data/shareXX/models

python -m vllm.entrypoints.openai.api_server \\
  --model Qwen/Qwen2.5-7B-Instruct \\
  --host 0.0.0.0 \\
  --port 8000`}</code>
      </pre>

      <h2>Technical Details</h2>

      <h3>How It Works</h3>
      <p>
        Persistent storage uses NFS (Network File System) provided by the
        infrastructure. When you add storage:
      </p>
      <ol>
        <li>A shared volume is created in the storage pool</li>
        <li>The volume is attached to your pod</li>
        <li>NFS mounts the volume at <code>/data/</code></li>
      </ol>

      <h3>Performance Tips</h3>
      <p>
        Network-attached storage has slightly higher latency than local SSD. For
        I/O intensive workloads:
      </p>
      <pre>
        <code>{`# Copy data locally for processing
sudo cp -r /data/shareXX/dataset /tmp/dataset

# Work with local copy, then sync back
sudo rsync -av /tmp/results/ /data/shareXX/results/`}</code>
      </pre>

      <h2>Billing</h2>
      <p>Persistent storage is billed per GB per hour:</p>
      <ul>
        <li>Billing starts when the volume is created</li>
        <li>
          Billing continues while the volume exists (even if the pod is stopped
          or terminated) — delete unused volumes from the <strong>Storage</strong> tab
          to stop charges
        </li>
        <li>Available sizes and prices vary by region — the dashboard shows the hourly price for each size before you create a volume</li>
      </ul>

      <h2>Troubleshooting</h2>

      <h3>Storage Not Visible</h3>
      <p>If you don&apos;t see your storage mount:</p>
      <pre>
        <code>{`# Check mount status
sudo mount | grep nfs

# Check if mount point exists
sudo ls -la /data/`}</code>
      </pre>

      <h3>Permission Issues</h3>
      <p>If you encounter permission errors:</p>
      <pre>
        <code>{`sudo mkdir /data/shareXX/new-folder
sudo chown $USER:$USER /data/shareXX/new-folder`}</code>
      </pre>

      <h2>Snapshots and Storage</h2>

      <h3>What is a Snapshot?</h3>
      <p>
        A snapshot saves your pod&apos;s <strong>configuration</strong> for easy re-deployment:
      </p>
      <ul>
        <li>GPU pool selection</li>
        <li>Number of GPUs</li>
        <li>Instance type</li>
        <li>Reference to your persistent storage volume</li>
        <li>Any HuggingFace model deployment settings</li>
      </ul>

      <h3>What Data Survives?</h3>
      <table>
        <thead>
          <tr>
            <th>Storage Type</th>
            <th>Location</th>
            <th>Survives Termination?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Persistent Storage</strong></td>
            <td><code>/data/shareXX/</code></td>
            <td className="docs-yes">Yes</td>
          </tr>
          <tr>
            <td><strong>Local Storage</strong></td>
            <td><code>/home/ubuntu</code>, <code>/tmp</code>, <code>/root</code></td>
            <td className="docs-no">No</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>Important:</strong> Local storage (local SSD) is wiped on termination.
        This includes pip packages, downloaded files, and anything not in <code>/data/</code>.
        Always store important data in persistent storage.
      </p>

      <h3>Snapshot Workflow</h3>
      <ol>
        <li><strong>Save important data</strong> to <code>/data/shareXX/</code> while running</li>
        <li><strong>Create a snapshot</strong> from the pod card menu</li>
        <li><strong>Terminate</strong> when done (your storage volume persists)</li>
        <li><strong>Restore from snapshot</strong> to launch a new pod with storage attached</li>
      </ol>

      <h3>Common Misconception</h3>
      <p>
        Snapshots do <strong>not</strong> capture local storage contents. They save a reference
        to your persistent storage volume. When you restore, you get:
      </p>
      <ul>
        <li>A fresh container (new <code>/home/ubuntu</code>, no installed packages)</li>
        <li>Your persistent storage mounted at <code>/data/</code> (with all your data intact)</li>
      </ul>
      <p>
        Think of it as &quot;bookmark + persistent disk&quot;, not &quot;full VM snapshot&quot;.
      </p>

      <h2>FAQs</h2>

      <h3>What happens if my pod crashes?</h3>
      <p>
        Your persistent storage data is safe. The NFS volume exists
        independently of your pod. When the pod restarts, the storage is
        automatically remounted.
      </p>

      <h3>Can I access storage after terminating my pod?</h3>
      <p>
        Yes! Persistent storage volumes are <strong>independent</strong> and survive
        pod termination. When you launch a new pod, you can attach your existing
        storage volume and your data will be there. This makes it easy to:
      </p>
      <ul>
        <li>Switch between GPU types without losing data</li>
        <li>Save costs by terminating pods when not in use</li>
      </ul>

      <h3>Is local or persistent storage faster?</h3>
      <p>
        Local storage uses local SSD and is faster for I/O operations.
        Persistent storage uses NFS and has some network latency. For maximum
        performance, copy working files to local storage.
      </p>

      <h2>Need Help?</h2>
      <p>
        Contact our support team via the <strong>Support</strong> tab
      </p>
    </div>
  );
}
