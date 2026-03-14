import { spawn } from "child_process";
import { getConnectionInfo } from "@/lib/hostedai";
import { injectServerKeyUsingSSHInfo } from "@/lib/ssh-keys";
import { validateSSHParams } from "@/lib/ssh-validation";

const METRICS_ENDPOINT = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/metrics/ingest`;
const MAX_ATTEMPTS = 20; // Try for ~10 minutes (30s intervals)
const RETRY_DELAY = 30000; // 30 seconds

/**
 * Install metrics collector on a pod after it starts.
 * Runs in background - waits for pod to be ready, then SSHs in to install the collector.
 */
export async function installMetricsCollector(
  subscriptionId: string,
  teamId: string,
  metricsToken: string
): Promise<void> {
  console.log(`[Metrics] Starting metrics collector installation for subscription ${subscriptionId}`);

  // Wait for pod to be ready with SSH info
  let pod: { ssh_info?: { cmd?: string; pass?: string }; pod_status?: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const connectionInfo = await getConnectionInfo(teamId);
      const conn = connectionInfo.find((c) => String(c.id) === subscriptionId);
      const podInfo = conn?.pods?.[0];

      if (podInfo?.pod_status?.toLowerCase() === "running" && podInfo?.ssh_info?.cmd && podInfo?.ssh_info?.pass) {
        pod = podInfo;
        console.log(`[Metrics] Pod ${subscriptionId} is ready (attempt ${attempt})`);
        break;
      }

      console.log(`[Metrics] Pod ${subscriptionId} not ready yet (attempt ${attempt}/${MAX_ATTEMPTS}), status: ${podInfo?.pod_status || "unknown"}`);
    } catch (err) {
      console.log(`[Metrics] Error checking pod ${subscriptionId} (attempt ${attempt}):`, err);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }

  if (!pod?.ssh_info?.cmd || !pod?.ssh_info?.pass) {
    console.error(`[Metrics] Pod ${subscriptionId} never became ready, giving up`);
    return;
  }

  // Parse SSH connection info
  const hostMatch = pod.ssh_info.cmd.match(/@([^\s]+)/);
  const portMatch = pod.ssh_info.cmd.match(/-p\s+(\d+)/);
  const userMatch = pod.ssh_info.cmd.match(/ssh\s+([^@]+)@/);

  const host = hostMatch ? hostMatch[1] : "localhost";
  const port = portMatch ? portMatch[1] : "22";
  const username = userMatch ? userMatch[1] : "ubuntu";
  const password = pod.ssh_info.pass;

  // FIRST: Inject server SSH key for future key-based access (before anything else)
  console.log(`[Metrics] Injecting server SSH key into pod ${subscriptionId}`);
  try {
    const keyResult = await injectServerKeyUsingSSHInfo(pod.ssh_info.cmd, password);
    if (keyResult.success) {
      console.log(`[Metrics] Server SSH key injected successfully: ${keyResult.output}`);
    } else {
      console.warn(`[Metrics] Failed to inject server SSH key: ${keyResult.output}`);
      // Continue anyway - metrics collector should still work with password auth
    }
  } catch (keyError) {
    console.warn(`[Metrics] Error injecting server SSH key:`, keyError);
    // Continue anyway - this is not critical for metrics
  }

  // The metrics collector script
  const collectorScript = `#!/bin/bash
# GPU Metrics Collector
# Sends GPU metrics to dashboard every 60 seconds

ENDPOINT="${METRICS_ENDPOINT}"
TOKEN="${metricsToken}"

while true; do
  # GPU-level metrics (temperature, power, total VRAM — shared across pods on same GPU)
  GPU_DATA=$(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed --format=csv,noheader,nounits 2>/dev/null)

  if [ -n "$GPU_DATA" ]; then
    # === PER-PROCESS METRICS (pod-level) ===
    # Build pipe-separated PID list for awk matching
    MY_PIDS=$(ps -eo pid --no-headers | sed 's/^ *//' | tr '\\n' '|' | sed 's/|$//')

    # Per-process VRAM (sum used_gpu_memory for this container's PIDs)
    POD_VRAM=0
    PROC_MEM_OUT=$(nvidia-smi --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null)
    if [ $? -eq 0 ]; then
      POD_VRAM=$(echo "$PROC_MEM_OUT" | awk -F, -v pids="$MY_PIDS" 'BEGIN { n=split(pids,p,"|"); for(i=1;i<=n;i++) pidset[p[i]]=1 } { gsub(/ /,"",$1); gsub(/ /,"",$2); if ($1 in pidset) sum+=$2 } END { print sum+0 }')
    fi

    # Per-process GPU SM utilization (1-second pmon sample)
    POD_SM=0
    PMON_OUT=$(nvidia-smi pmon -c 1 -s u 2>/dev/null)
    if [ $? -eq 0 ]; then
      POD_SM=$(echo "$PMON_OUT" | grep -v '^#' | awk -v pids="$MY_PIDS" 'BEGIN { n=split(pids,p,"|"); for(i=1;i<=n;i++) pidset[p[i]]=1 } { if ($2 in pidset && $4 != "-") sum+=$4 } END { print sum+0 }')
    fi

    # Get CPU usage
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2 + $4}' 2>/dev/null || echo "0")

    # Get memory info
    MEM_INFO=$(free -m | grep Mem 2>/dev/null)
    MEM_USED=$(echo "$MEM_INFO" | awk '{print $3}')
    MEM_TOTAL=$(echo "$MEM_INFO" | awk '{print $2}')

    # Get disk usage for /workspace (persistent storage) and root
    DISK_WS=$(df -BM /workspace 2>/dev/null | tail -1 | awk '{gsub("M",""); print $3","$2}')
    DISK_ROOT=$(df -BM / 2>/dev/null | tail -1 | awk '{gsub("M",""); print $3","$2}')

    # Send metrics (includes per-process pod_gpu_util and pod_vram_mb)
    curl -s -X POST "$ENDPOINT" \\
      -H "Content-Type: application/json" \\
      -d "{\\"token\\":\\"$TOKEN\\",\\"gpu\\":\\"$GPU_DATA\\",\\"pod_gpu_util\\":$POD_SM,\\"pod_vram_mb\\":$POD_VRAM,\\"cpu\\":\\"$CPU\\",\\"mem_used\\":\\"$MEM_USED\\",\\"mem_total\\":\\"$MEM_TOTAL\\",\\"disk_workspace\\":\\"$DISK_WS\\",\\"disk_root\\":\\"$DISK_ROOT\\"}" \\
      > /dev/null 2>&1
  fi

  sleep 60
done
`;

  // Install command - creates the script and starts it via systemd
  const installCommand = `
mkdir -p /opt/gpu-metrics
cat > /opt/gpu-metrics/collect.sh << 'SCRIPT_EOF'
${collectorScript}
SCRIPT_EOF
chmod +x /opt/gpu-metrics/collect.sh

# Create systemd service
cat > /etc/systemd/system/gpu-metrics.service << 'SERVICE_EOF'
[Unit]
Description=GPU Metrics Collector
After=network.target

[Service]
Type=simple
ExecStart=/opt/gpu-metrics/collect.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Start the service
systemctl daemon-reload
systemctl enable gpu-metrics
systemctl start gpu-metrics
echo "METRICS_INSTALLED"
`;

  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port: parseInt(port, 10), username });

  // Execute via SSH
  return new Promise((resolve) => {
    const args = [
      "-e",
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=10",
      "-p", port,
      `${username}@${host}`,
      installCommand,
    ];

    let output = "";
    const proc = spawn("sshpass", args, {
      timeout: 60000,
      env: { ...process.env, SSHPASS: password },
    });

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && output.includes("METRICS_INSTALLED")) {
        console.log(`[Metrics] Successfully installed metrics collector on subscription ${subscriptionId}`);
      } else {
        console.error(`[Metrics] Failed to install metrics collector on ${subscriptionId} (code ${code}):`, output.slice(0, 500));
      }
      resolve();
    });

    proc.on("error", (err) => {
      console.error(`[Metrics] SSH error installing metrics collector on ${subscriptionId}:`, err);
      resolve();
    });

    // Timeout after 60s
    setTimeout(() => {
      proc.kill();
      console.error(`[Metrics] Timeout installing metrics collector on ${subscriptionId}`);
      resolve();
    }, 60000);
  });
}
