/**
 * CRON: Collect GPU Hardware Metrics (Every 180 seconds)
 *
 * Collects GPU metrics from ALL running pods across all teams
 * and stores them in the GpuHardwareMetrics table for historical graphing.
 *
 * Uses the same approach as admin pods - gets all teams from resource policy
 * and collects metrics from each running pod via SSH.
 *
 * Triggered by cron-job.org every 3 minutes:
 * GET /api/cron/collect-gpu-metrics?secret=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPoolSubscriptions, getConnectionInfo } from "@/lib/hostedai";
import { getDefaultResourcePolicy } from "@/lib/hostedai/policies";
import { getStripe } from "@/lib/stripe";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";
import { verifyCronAuth } from "@/lib/cron-auth";

interface GPUMetrics {
  gpuUtilization: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  fanSpeed: number;
}

interface SystemMetrics {
  cpuPercent: number;
  systemMemUsedMb: number;
  systemMemTotalMb: number;
  systemMemPercent: number;
}

/**
 * Execute SSH command on a pod
 */
async function executeSSHCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs: number = 10000
): Promise<{ success: boolean; output: string }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
    const args = [
      "-e",
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=5",
      "-p", String(port),
      `${username}@${host}`,
      command,
    ];

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const proc = spawn("sshpass", args, {
      timeout: timeoutMs,
      env: { ...process.env, SSHPASS: password },
    });

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        resolve({
          success: code === 0,
          output: stdout + (stderr ? `\nSTDERR: ${stderr}` : ""),
        });
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        resolve({
          success: false,
          output: `Error: ${err.message}`,
        });
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({
          success: false,
          output: "Command timed out",
        });
      }
    }, timeoutMs);
  });
}

/**
 * Parse SSH connection info from command string
 * Handles both formats:
 * - ssh -p <port> <user>@<host>
 * - ssh <user>@<host> -p <port>
 */
function parseSSHInfo(cmd: string): { host: string; port: number; username: string } | null {
  // Try format: ssh -p <port> <user>@<host>
  let match = cmd.match(/ssh\s+-p\s+(\d+)\s+(\w+)@([^\s]+)/);
  if (match) {
    return {
      port: parseInt(match[1], 10),
      username: match[2],
      host: match[3],
    };
  }

  // Try format: ssh <user>@<host> -p <port>
  match = cmd.match(/ssh\s+(\w+)@([^\s]+)\s+-p\s+(\d+)/);
  if (match) {
    return {
      username: match[1],
      host: match[2],
      port: parseInt(match[3], 10),
    };
  }

  return null;
}

/**
 * Fetch GPU and system metrics from a pod via SSH
 */
async function fetchPodMetrics(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<{
  gpu: GPUMetrics | null;
  system: SystemMetrics | null;
}> {
  const metricsCommand = `
    # GPU-level metrics (for temperature, power, total VRAM, fan — shared across pods)
    NVIDIA_OUTPUT=$(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed --format=csv,noheader,nounits 2>/dev/null)
    if [ -n "$NVIDIA_OUTPUT" ]; then
      echo "NVIDIA_SMI=$NVIDIA_OUTPUT"
    fi

    VRAM_INFO=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
    if [ -n "$VRAM_INFO" ]; then
      echo "VRAM_INFO=$VRAM_INFO"
    fi

    # === PER-PROCESS METRICS (pod-level — only this container's GPU usage) ===
    # Build pipe-separated PID list for awk matching
    MY_PIDS=$(ps -eo pid --no-headers | sed 's/^ *//' | tr '\n' '|' | sed 's/|$//')

    # Per-process VRAM (sum used_gpu_memory for this container's PIDs)
    PERPROC_VRAM=0
    PERPROC_VRAM_OK=0
    PROC_MEM_OUT=$(nvidia-smi --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null)
    if [ $? -eq 0 ]; then
      PERPROC_VRAM_OK=1
      PERPROC_VRAM=$(echo "$PROC_MEM_OUT" | awk -F, -v pids="$MY_PIDS" '
        BEGIN { n=split(pids,p,"|"); for(i=1;i<=n;i++) pidset[p[i]]=1 }
        { gsub(/ /,"",$1); gsub(/ /,"",$2); if ($1 in pidset) sum+=$2 }
        END { print sum+0 }
      ')
    fi
    echo "PERPROC_VRAM=$PERPROC_VRAM"
    echo "PERPROC_VRAM_OK=$PERPROC_VRAM_OK"

    # Per-process GPU SM utilization (1-second pmon sample, sum for container PIDs)
    PERPROC_SM=0
    PERPROC_SM_OK=0
    PMON_OUT=$(nvidia-smi pmon -c 1 -s u 2>/dev/null)
    if [ $? -eq 0 ]; then
      PERPROC_SM_OK=1
      PERPROC_SM=$(echo "$PMON_OUT" | grep -v '^#' | awk -v pids="$MY_PIDS" '
        BEGIN { n=split(pids,p,"|"); for(i=1;i<=n;i++) pidset[p[i]]=1 }
        { if ($2 in pidset && $4 != "-") sum+=$4 }
        END { print sum+0 }
      ')
    fi
    echo "PERPROC_SM=$PERPROC_SM"
    echo "PERPROC_SM_OK=$PERPROC_SM_OK"

    # CPU usage
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2 + $4}' 2>/dev/null || echo "0")
    echo "CPU_USAGE=$CPU_USAGE"

    # System memory
    MEM_INFO=$(free -m | grep Mem 2>/dev/null)
    if [ -n "$MEM_INFO" ]; then
      MEM_TOTAL=$(echo "$MEM_INFO" | awk '{print $2}')
      MEM_USED=$(echo "$MEM_INFO" | awk '{print $3}')
      echo "MEM_TOTAL=$MEM_TOTAL"
      echo "MEM_USED=$MEM_USED"
    fi
  `;

  const result = await executeSSHCommand(host, port, username, password, metricsCommand);

  if (!result.success) {
    return { gpu: null, system: null };
  }

  const output = result.output;
  let gpu: GPUMetrics | null = null;
  let system: SystemMetrics | null = null;

  // Parse GPU-level nvidia-smi output (for temperature, power, total VRAM)
  const nvidiaSmiMatch = output.match(/NVIDIA_SMI=([^\n]+)/);
  if (nvidiaSmiMatch) {
    const values = nvidiaSmiMatch[1].split(",").map(v => {
      const parsed = parseFloat(v.trim());
      return isNaN(parsed) ? 0 : parsed;
    });
    if (values.length >= 6) {
      let memoryUsedMb = values[1] || 0;
      let memoryTotalMb = values[2] || 0;

      if (memoryUsedMb === 0 || memoryTotalMb === 0) {
        const vramMatch = output.match(/VRAM_INFO=([^\n]+)/);
        if (vramMatch) {
          const vramValues = vramMatch[1].split(",").map(v => {
            const parsed = parseFloat(v.trim());
            return isNaN(parsed) ? 0 : parsed;
          });
          if (vramValues.length >= 2) {
            memoryUsedMb = vramValues[0] || memoryUsedMb;
            memoryTotalMb = vramValues[1] || memoryTotalMb;
          }
        }
      }

      gpu = {
        gpuUtilization: values[0] || 0,
        memoryUsedMb,
        memoryTotalMb,
        memoryPercent: memoryTotalMb ? (memoryUsedMb / memoryTotalMb) * 100 : 0,
        temperature: values[3] || 0,
        powerDraw: values[4] || 0,
        powerLimit: values[5] || 0,
        fanSpeed: values[6] || 0,
      };

      // Override with per-process metrics if available (pod-level instead of GPU-level)
      const perprocVramOk = /PERPROC_VRAM_OK=1/.test(output);
      const perprocSmOk = /PERPROC_SM_OK=1/.test(output);
      const perprocVramMatch = output.match(/PERPROC_VRAM=(\d+)/);
      const perprocSmMatch = output.match(/PERPROC_SM=(\d+)/);

      if (perprocVramOk && perprocVramMatch) {
        const podVram = parseInt(perprocVramMatch[1]);
        gpu.memoryUsedMb = podVram;
        gpu.memoryPercent = memoryTotalMb > 0 ? (podVram / memoryTotalMb) * 100 : 0;
      }
      if (perprocSmOk && perprocSmMatch) {
        gpu.gpuUtilization = Math.min(100, parseInt(perprocSmMatch[1]));
      }
    }
  }

  // Parse system metrics
  const cpuMatch = output.match(/CPU_USAGE=(\d+\.?\d*)/);
  const memTotalMatch = output.match(/MEM_TOTAL=(\d+)/);
  const memUsedMatch = output.match(/MEM_USED=(\d+)/);

  if (memTotalMatch && memUsedMatch) {
    const memTotal = parseFloat(memTotalMatch[1]);
    const memUsed = parseFloat(memUsedMatch[1]);
    system = {
      cpuPercent: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
      systemMemUsedMb: memUsed,
      systemMemTotalMb: memTotal,
      systemMemPercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
    };
  }

  return { gpu, system };
}

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed: rejects if CRON_SECRET is not set)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results = {
    collected: 0,
    failed: 0,
    skipped: 0,
    teams: 0,
    errors: [] as string[],
  };

  try {
    // Always collect via SSH — even in "db" mode, pods may not have the collector installed
    // (e.g. HuggingFace deployments). SSH collection ensures we always have VRAM data
    // for pool selection (selectOptimalPool needs GpuHardwareMetrics).

    // Step 1: Get all teams from the default resource policy (same as admin pods)
    const policy = await getDefaultResourcePolicy();
    const teams = policy.teams || [];
    results.teams = teams.length;

    console.log(`[GPU Metrics] Found ${teams.length} teams in resource policy`);

    // Step 2: Build a map of teamId -> customer info from Stripe
    const stripe = await getStripe();
    const teamToCustomer: Map<string, string> = new Map();

    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const customers = await stripe.customers.list({
        limit: 100,
        starting_after: startingAfter,
      });

      for (const customer of customers.data) {
        const teamId = customer.metadata?.hostedai_team_id;
        if (teamId) {
          teamToCustomer.set(teamId, customer.id);
        }
      }

      hasMore = customers.has_more;
      if (customers.data.length > 0) {
        startingAfter = customers.data[customers.data.length - 1].id;
      }
    }

    // Step 3: Collect metrics from all teams in parallel batches
    const metricsToInsert: Array<{
      subscriptionId: string;
      stripeCustomerId: string;
      teamId: string;
      poolId: number;
      poolName: string;
      gpuUtilization: number;
      memoryUsedMb: number;
      memoryTotalMb: number;
      memoryPercent: number;
      temperature: number;
      powerDraw: number;
      powerLimit: number;
      fanSpeed: number;
      cpuPercent: number | null;
      systemMemUsedMb: number | null;
      systemMemTotalMb: number | null;
      systemMemPercent: number | null;
    }> = [];

    const batchSize = 10;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (team) => {
          const teamMetrics: typeof metricsToInsert = [];

          try {
            const [subscriptionsResult, connectionInfoResult] = await Promise.all([
              getPoolSubscriptions(team.id).catch(() => []),
              getConnectionInfo(team.id).catch(() => []),
            ]);

            // Ensure both results are arrays (API may return non-array data for teams with no resources)
            const subscriptions = Array.isArray(subscriptionsResult) ? subscriptionsResult : [];
            const connectionInfo = Array.isArray(connectionInfoResult) ? connectionInfoResult : [];

            // Build connection info map
            const connMap = new Map<string, { host: string; port: number; username: string; password: string }>();
            for (const conn of connectionInfo) {
              if (conn.id && conn.pods && conn.pods.length > 0) {
                const pod = conn.pods[0];
                if (pod.ssh_info?.cmd && pod.ssh_info?.pass) {
                  const sshInfo = parseSSHInfo(pod.ssh_info.cmd);
                  if (sshInfo) {
                    connMap.set(String(conn.id), {
                      ...sshInfo,
                      password: pod.ssh_info.pass,
                    });
                  }
                }
              }
            }

            // Process each subscription
            for (const sub of subscriptions) {
              const status = sub.status?.toLowerCase();
              if (status !== "subscribed" && status !== "active" && status !== "running") {
                results.skipped++;
                continue;
              }

              const subId = String(sub.id);
              const conn = connMap.get(subId);

              if (!conn) {
                results.skipped++;
                continue;
              }

              try {
                const metrics = await fetchPodMetrics(conn.host, conn.port, conn.username, conn.password);

                if (metrics.gpu) {
                  teamMetrics.push({
                    subscriptionId: subId,
                    stripeCustomerId: teamToCustomer.get(team.id) || "unknown",
                    teamId: team.id,
                    poolId: parseInt(sub.pool_id, 10) || 0,
                    poolName: sub.pool_name || "",
                    gpuUtilization: metrics.gpu.gpuUtilization,
                    memoryUsedMb: metrics.gpu.memoryUsedMb,
                    memoryTotalMb: metrics.gpu.memoryTotalMb,
                    memoryPercent: metrics.gpu.memoryPercent,
                    temperature: metrics.gpu.temperature,
                    powerDraw: metrics.gpu.powerDraw,
                    powerLimit: metrics.gpu.powerLimit,
                    fanSpeed: metrics.gpu.fanSpeed,
                    cpuPercent: metrics.system?.cpuPercent ?? null,
                    systemMemUsedMb: metrics.system?.systemMemUsedMb ?? null,
                    systemMemTotalMb: metrics.system?.systemMemTotalMb ?? null,
                    systemMemPercent: metrics.system?.systemMemPercent ?? null,
                  });
                  results.collected++;
                } else {
                  results.failed++;
                }
              } catch (fetchError) {
                results.failed++;
              }
            }
          } catch (teamError) {
            results.errors.push(`Team ${team.id}: ${teamError}`);
          }

          return teamMetrics;
        })
      );

      metricsToInsert.push(...batchResults.flat());
    }

    // Step 4: Batch insert all metrics
    if (metricsToInsert.length > 0) {
      await prisma.gpuHardwareMetrics.createMany({
        data: metricsToInsert,
      });
      console.log(`[GPU Metrics] Inserted ${metricsToInsert.length} metrics records`);
    }

    // Step 5: Clean up old metrics (keep last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleteResult = await prisma.gpuHardwareMetrics.deleteMany({
      where: { timestamp: { lt: sevenDaysAgo } },
    });

    if (deleteResult.count > 0) {
      console.log(`[GPU Metrics] Cleaned up ${deleteResult.count} old records`);
    }

    // Clean up PodUptimeDay for pods with no heartbeat in 7+ days
    try {
      const uptimeCleanup = await prisma.$executeRaw`
        DELETE FROM pod_uptime_day
        WHERE subscription_id IN (
          SELECT subscription_id FROM pod_uptime_day
          GROUP BY subscription_id
          HAVING MAX(last_seen) < ${sevenDaysAgo}
        )
      `;
      if (uptimeCleanup > 0) {
        console.log(`[GPU Metrics] Cleaned up uptime data for ${uptimeCleanup} terminated pod records`);
      }
    } catch (uptimeErr) {
      console.error("[GPU Metrics] Failed to clean up uptime data:", uptimeErr);
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      results,
    });
  } catch (error) {
    console.error("GPU metrics collection error:", error);
    return NextResponse.json(
      { error: "Failed to collect metrics", details: String(error) },
      { status: 500 }
    );
  }
}
