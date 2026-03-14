import { prisma } from "@/lib/prisma";
import { validateSSHParams } from "@/lib/ssh-validation";

/**
 * ASCII banner written to the pod's MOTD so users see it on SSH login.
 * Appended to ~/.bashrc on first run (guarded by a marker comment).
 */
const MOTD_SETUP_SCRIPT = `
# Setup GPU cloud welcome banner
if ! grep -q "gpu-cloud-motd" ~/.bashrc 2>/dev/null; then
  cat >> ~/.bashrc << 'MOTD_EOF'

# gpu-cloud-motd
if [ -z "$GPU_CLOUD_MOTD_SHOWN" ]; then
  export GPU_CLOUD_MOTD_SHOWN=1
  echo ""
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║         GPU Cloud Platform            ║"
  echo "  ║       Powered by hosted.ai            ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo ""
fi
MOTD_EOF
fi
`;

export async function runStartupScript(
  subscriptionId: string,
  teamId: string,
  script: string,
  presetId?: string
): Promise<void> {
  const { getConnectionInfo } = await import("@/lib/hostedai");
  const { exposeService } = await import("@/lib/hostedai/services");
  const { getStartupScriptPreset } = await import("@/lib/startup-scripts");
  const { spawn } = await import("child_process");

  const MAX_ATTEMPTS = 20; // Try for ~10 minutes (30s intervals)
  const RETRY_DELAY = 30000; // 30 seconds

  console.log(`[Startup] Starting startup script execution for subscription ${subscriptionId}`);

  // Update status to pending
  try {
    await prisma.podMetadata.update({
      where: { subscriptionId },
      data: { startupScriptStatus: "pending" },
    });
  } catch {
    // Ignore if metadata doesn't exist yet
  }

  // Wait for pod to be ready with SSH info
  let pod: { ssh_info?: { cmd?: string; pass?: string }; pod_status?: string; pod_name?: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const connectionInfo = await getConnectionInfo(teamId);
      const conn = connectionInfo.find((c) => String(c.id) === subscriptionId);
      const podInfo = conn?.pods?.[0];

      if (podInfo?.pod_status?.toLowerCase() === "running" && podInfo?.ssh_info?.cmd && podInfo?.ssh_info?.pass) {
        pod = podInfo;
        console.log(`[Startup] Pod ${subscriptionId} is ready (attempt ${attempt})`);
        break;
      }

      console.log(`[Startup] Pod ${subscriptionId} not ready yet (attempt ${attempt}/${MAX_ATTEMPTS}), status: ${podInfo?.pod_status || "unknown"}`);
    } catch (err) {
      console.log(`[Startup] Error checking pod ${subscriptionId} (attempt ${attempt}):`, err);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }

  if (!pod?.ssh_info?.cmd || !pod?.ssh_info?.pass) {
    console.error(`[Startup] Pod ${subscriptionId} never became ready, giving up`);
    await prisma.podMetadata.update({
      where: { subscriptionId },
      data: {
        startupScriptStatus: "failed",
        startupScriptOutput: "Pod did not become ready in time",
      },
    }).catch(() => {});
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

  // Update status to running
  await prisma.podMetadata.update({
    where: { subscriptionId },
    data: { startupScriptStatus: "running" },
  }).catch(() => {});

  // Prepend the MOTD banner setup, then the user's script
  const fullScript = MOTD_SETUP_SCRIPT + "\n" + script;

  // Base64 encode the script to avoid shell escaping issues
  const encodedScript = Buffer.from(fullScript).toString("base64");
  // Use explicit exit at end to ensure SSH session closes cleanly
  const remoteCommand = `echo '${encodedScript}' | base64 -d | bash 2>&1; exit $?`;

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
      "-o", "ConnectTimeout=20",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-p", port,
      `${username}@${host}`,
      remoteCommand,
    ];

    let output = "";
    const proc = spawn("sshpass", args, {
      timeout: 600000, // 10 minute timeout for longer scripts
      env: { ...process.env, SSHPASS: password },
    });

    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", async (code) => {
      const success = code === 0;
      console.log(`[Startup] Script execution completed for ${subscriptionId} with code ${code}`);

      // Update metadata with result
      try {
        await prisma.podMetadata.update({
          where: { subscriptionId },
          data: {
            startupScriptStatus: success ? "completed" : "failed",
            startupScriptOutput: output.slice(0, 10000),
          },
        });
      } catch (e) {
        console.error(`[Startup] Failed to update metadata for ${subscriptionId}:`, e);
      }

      if (success) {
        console.log(`[Startup] Successfully ran startup script on subscription ${subscriptionId}`);

        // Automatically expose ports if a preset was used
        if (presetId && pod) {
          const preset = getStartupScriptPreset(presetId);
          if (preset?.portsToExpose && preset.portsToExpose.length > 0) {
            console.log(`[Startup] Auto-exposing ${preset.portsToExpose.length} port(s) for preset ${presetId}`);

            const podName = (pod as { pod_name?: string }).pod_name;
            if (podName) {
              for (const portConfig of preset.portsToExpose) {
                try {
                  console.log(`[Startup] Exposing port ${portConfig.port} (${portConfig.name}) on pod ${podName}`);
                  await exposeService({
                    pod_name: podName,
                    pool_subscription_id: Number(subscriptionId),
                    port: portConfig.port,
                    service_name: portConfig.name,
                    protocol: "TCP",
                    service_type: "http",
                  });
                  console.log(`[Startup] Successfully exposed port ${portConfig.port} (${portConfig.name})`);
                } catch (exposeErr) {
                  console.error(`[Startup] Failed to expose port ${portConfig.port} (${portConfig.name}):`, exposeErr);
                }
              }
            } else {
              console.error(`[Startup] Could not determine pod_name for auto-port exposure`);
            }
          }
        }
      } else {
        console.error(`[Startup] Startup script failed on ${subscriptionId} (code ${code}):`, output.slice(0, 1000));
      }
      resolve();
    });

    proc.on("error", async (err) => {
      console.error(`[Startup] SSH error running startup script on ${subscriptionId}:`, err);
      try {
        await prisma.podMetadata.update({
          where: { subscriptionId },
          data: {
            startupScriptStatus: "failed",
            startupScriptOutput: `SSH error: ${err.message}`,
          },
        });
      } catch {
        // Ignore
      }
      resolve();
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      proc.kill();
      console.error(`[Startup] Timeout running startup script on ${subscriptionId}`);
      prisma.podMetadata.update({
        where: { subscriptionId },
        data: {
          startupScriptStatus: "failed",
          startupScriptOutput: output.slice(0, 10000) + "\n\n[TIMEOUT after 10 minutes]",
        },
      }).catch(() => {});
      resolve();
    }, 600000);
  });
}
