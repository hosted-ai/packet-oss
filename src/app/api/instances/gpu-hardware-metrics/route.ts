/**
 * GET /api/instances/gpu-hardware-metrics
 *
 * Aggregates real-time GPU hardware metrics from all running pods via nvidia-smi
 * Used for dashboard landing page and Metrics tab
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getConnectionInfo, getPoolSubscriptions } from "@/lib/hostedai";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";
import { prisma } from "@/lib/prisma";

interface GPUMetrics {
  // Basic metrics
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  fanSpeed: number;
  // Advanced SM metrics
  smActivity?: number;
  smOccupancy?: number;
  tensorActivity?: number;
  memoryBandwidth?: number;
  efficiencyScore?: number;
  efficiencyAlert?: string;
}

interface SystemMetrics {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;  // Node total (for reference)
  memoryPercent: number;
  allocatedMemoryMb?: number;  // Pod allocated memory from subscription
}

interface PodGPUMetrics {
  subscriptionId: string;
  podName: string;
  poolName: string;
  status: string;
  gpu: GPUMetrics | null;
  system: SystemMetrics | null;
  error?: string;
}

interface AggregatedMetrics {
  pods: PodGPUMetrics[];
  totals: {
    // GPU metrics
    avgUtilization: number;
    totalMemoryUsed: number;
    totalMemoryTotal: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    totalPowerDraw: number;
    maxTemperature: number;
    // System metrics
    avgCpuPercent: number;
    totalSystemMemoryUsedMb: number;
    totalSystemMemoryTotalMb: number;
    avgSystemMemoryPercent: number;
    // Counts
    activePods: number;
    podsWithMetrics: number;
  };
  timestamp: string;
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
  timeoutMs: number = 15000
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
      "-o", "ConnectTimeout=10",
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

    // Timeout handler
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
 */
function parseSSHInfo(cmd: string): { host: string; port: number; username: string } {
  const hostMatch = cmd.match(/@([^\s]+)/);
  const portMatch = cmd.match(/-p\s+(\d+)/);
  const userMatch = cmd.match(/ssh\s+([^@]+)@/);

  return {
    host: hostMatch ? hostMatch[1] : "localhost",
    port: portMatch ? parseInt(portMatch[1], 10) : 22,
    username: userMatch ? userMatch[1] : "root",
  };
}

/**
 * Fetch GPU and system metrics from a single pod via SSH using nvidia-smi
 * nvidia-smi is the most reliable method in containerized environments
 */
async function fetchPodMetrics(
  host: string,
  port: number,
  username: string,
  password: string,
  allocatedMemoryMb?: number  // Pod's allocated memory from subscription
): Promise<{
  gpu: GPUMetrics | null;
  system: SystemMetrics | null;
  error?: string;
}> {
  // Command to get GPU and system metrics via nvidia-smi (including SM activity)
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

    # SM activity via dmon (single sample)
    DMON=$(nvidia-smi dmon -s u -c 1 2>/dev/null | tail -1 | awk '{print $2,$3}')
    if [ -n "$DMON" ]; then
      echo "DMON=$DMON"
    fi

    # Memory bandwidth utilization
    MEMBW=$(nvidia-smi --query-gpu=utilization.memory --format=csv,noheader,nounits 2>/dev/null)
    if [ -n "$MEMBW" ]; then
      echo "MEMBW=$MEMBW"
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

    # CPU usage (1-second average)
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2 + $4}' 2>/dev/null || echo "0")
    echo "CPU_USAGE=$CPU_USAGE"

    # System memory usage
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
    return {
      gpu: null,
      system: null,
      error: result.output,
    };
  }

  const output = result.output;
  let gpu: GPUMetrics | null = null;
  let system: SystemMetrics | null = null;

  // Parse nvidia-smi output for GPU metrics
  const nvidiaSmiMatch = output.match(/NVIDIA_SMI=([^\n]+)/);
  if (nvidiaSmiMatch) {
    const values = nvidiaSmiMatch[1].split(",").map(v => {
      const parsed = parseFloat(v.trim());
      // Return 0 for NaN (happens when nvidia-smi returns "[Not Supported]")
      return isNaN(parsed) ? 0 : parsed;
    });
    if (values.length >= 6) {
      let memoryUsed = values[1] || 0;
      let memoryTotal = values[2] || 0;

      // Fallback: If memory values are 0, try the separate VRAM query
      if (memoryUsed === 0 || memoryTotal === 0) {
        const vramMatch = output.match(/VRAM_INFO=([^\n]+)/);
        if (vramMatch) {
          const vramValues = vramMatch[1].split(",").map(v => {
            const parsed = parseFloat(v.trim());
            return isNaN(parsed) ? 0 : parsed;
          });
          if (vramValues.length >= 2) {
            memoryUsed = vramValues[0] || memoryUsed;
            memoryTotal = vramValues[1] || memoryTotal;
          }
        }
      }

      const utilization = values[0] || 0;

      gpu = {
        utilization,
        memoryUsed,
        memoryTotal,
        memoryPercent: memoryTotal ? (memoryUsed / memoryTotal) * 100 : 0,
        temperature: values[3] || 0,
        powerDraw: values[4] || 0,
        powerLimit: values[5] || 0,
        fanSpeed: values[6] || 0,
      };

      // Parse SM activity from dmon
      const dmonMatch = output.match(/DMON=(\d+)\s+(\d+)/);
      if (dmonMatch) {
        gpu.smActivity = parseInt(dmonMatch[1]) || 0;
        gpu.memoryBandwidth = parseInt(dmonMatch[2]) || 0;
      }

      // Fallback memory bandwidth
      const membwMatch = output.match(/MEMBW=(\d+)/);
      if (membwMatch && !gpu.memoryBandwidth) {
        gpu.memoryBandwidth = parseInt(membwMatch[1]) || 0;
      }

      // Calculate efficiency score
      if (gpu.smActivity !== undefined && utilization > 0) {
        const efficiency = gpu.smActivity / utilization;
        gpu.efficiencyScore = Math.round(efficiency * 100);

        // Generate efficiency alert
        if (utilization >= 80 && gpu.smActivity < 30) {
          gpu.efficiencyAlert = "High utilization but low compute. Possible communication bottleneck.";
        } else if (utilization >= 50 && efficiency < 0.3) {
          gpu.efficiencyAlert = "Low efficiency. Workload may be I/O bound.";
        }
      }

      // Override with per-process metrics if available (pod-level instead of GPU-level)
      const perprocVramOk = /PERPROC_VRAM_OK=1/.test(output);
      const perprocSmOk = /PERPROC_SM_OK=1/.test(output);
      const perprocVramMatch = output.match(/PERPROC_VRAM=(\d+)/);
      const perprocSmMatch = output.match(/PERPROC_SM=(\d+)/);

      if (perprocVramOk && perprocVramMatch) {
        const podVram = parseInt(perprocVramMatch[1]);
        gpu.memoryUsed = podVram;
        gpu.memoryPercent = memoryTotal > 0 ? (podVram / memoryTotal) * 100 : 0;
      }
      if (perprocSmOk && perprocSmMatch) {
        gpu.utilization = Math.min(100, parseInt(perprocSmMatch[1]));
      }
    }
  }

  // Parse system metrics
  const cpuMatch = output.match(/CPU_USAGE=(\d+\.?\d*)/);
  const memTotalMatch = output.match(/MEM_TOTAL=(\d+)/);
  const memUsedMatch = output.match(/MEM_USED=(\d+)/);

  if (memTotalMatch && memUsedMatch) {
    const nodeMemTotal = parseFloat(memTotalMatch[1]);
    const memUsed = parseFloat(memUsedMatch[1]);
    // Use allocated memory as "total" if available, otherwise fall back to node total
    const effectiveTotal = allocatedMemoryMb || nodeMemTotal;
    system = {
      cpuPercent: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
      memoryUsedMb: memUsed,
      memoryTotalMb: effectiveTotal,  // Use pod allocation as total
      memoryPercent: effectiveTotal > 0 ? (memUsed / effectiveTotal) * 100 : 0,
      allocatedMemoryMb,
    };
  }

  return {
    gpu,
    system,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with account" }, { status: 400 });
    }

    // === DB MODE: Read metrics from GpuHardwareMetrics table (no SSH) ===
    if (process.env.GPU_METRICS_SOURCE === "db") {
      const subscriptions = await getPoolSubscriptions(teamId).catch(() => []);
      const runningSubscriptions = subscriptions.filter((s) => {
        const status = s.status?.toLowerCase();
        return status === "subscribed" || status === "active" || status === "running";
      });

      const subIds = runningSubscriptions.map((s) => String(s.id));
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentMetrics = await prisma.gpuHardwareMetrics.findMany({
        where: {
          subscriptionId: { in: subIds },
          timestamp: { gte: fiveMinAgo },
        },
        orderBy: { timestamp: "desc" },
      });

      // Keep only the latest row per subscription
      const metricsMap = new Map<string, (typeof recentMetrics)[0]>();
      for (const m of recentMetrics) {
        if (!metricsMap.has(m.subscriptionId)) {
          metricsMap.set(m.subscriptionId, m);
        }
      }

      const podMetrics: PodGPUMetrics[] = runningSubscriptions.map((sub) => {
        const subId = String(sub.id);
        const m = metricsMap.get(subId);
        const podName = sub.pods?.[0]?.pod_name || `pod-${subId}`;
        const podStatus = sub.pods?.[0]?.pod_status || sub.status;

        if (!m) {
          return {
            subscriptionId: subId,
            podName,
            poolName: sub.pool_name || "Unknown",
            status: podStatus,
            gpu: null,
            system: null,
            error: "No recent metrics data",
          };
        }

        const allocatedRamMb = sub.per_pod_info?.ram_mb;
        const effectiveMemTotal = allocatedRamMb || m.systemMemTotalMb || 0;

        return {
          subscriptionId: subId,
          podName,
          poolName: sub.pool_name || "Unknown",
          status: podStatus,
          gpu: {
            utilization: m.gpuUtilization,
            memoryUsed: m.memoryUsedMb,
            memoryTotal: m.memoryTotalMb,
            memoryPercent: m.memoryPercent,
            temperature: m.temperature,
            powerDraw: m.powerDraw,
            powerLimit: m.powerLimit,
            fanSpeed: m.fanSpeed,
          },
          system:
            m.cpuPercent != null
              ? {
                  cpuPercent: m.cpuPercent,
                  memoryUsedMb: m.systemMemUsedMb || 0,
                  memoryTotalMb: effectiveMemTotal,
                  memoryPercent:
                    effectiveMemTotal > 0
                      ? ((m.systemMemUsedMb || 0) / effectiveMemTotal) * 100
                      : 0,
                  allocatedMemoryMb: allocatedRamMb,
                }
              : null,
        };
      });

      // Calculate aggregated totals
      const podsWithGpu = podMetrics.filter((p) => p.gpu !== null);
      const podsWithSys = podMetrics.filter((p) => p.system !== null);
      const totals = {
        avgUtilization: 0,
        totalMemoryUsed: 0,
        totalMemoryTotal: 0,
        avgMemoryPercent: 0,
        avgTemperature: 0,
        totalPowerDraw: 0,
        maxTemperature: 0,
        avgCpuPercent: 0,
        totalSystemMemoryUsedMb: 0,
        totalSystemMemoryTotalMb: 0,
        avgSystemMemoryPercent: 0,
        activePods: podMetrics.filter((p) => p.status?.toLowerCase() === "running").length,
        podsWithMetrics: podsWithGpu.length,
      };

      if (podsWithGpu.length > 0) {
        let totalUtil = 0, totalMemPercent = 0, totalTemp = 0;
        for (const pod of podsWithGpu) {
          if (pod.gpu) {
            totalUtil += pod.gpu.utilization;
            totals.totalMemoryUsed += pod.gpu.memoryUsed;
            totals.totalMemoryTotal += pod.gpu.memoryTotal;
            totalMemPercent += pod.gpu.memoryPercent;
            totalTemp += pod.gpu.temperature;
            totals.totalPowerDraw += pod.gpu.powerDraw;
            if (pod.gpu.temperature > totals.maxTemperature) {
              totals.maxTemperature = pod.gpu.temperature;
            }
          }
        }
        totals.avgUtilization = totalUtil / podsWithGpu.length;
        totals.avgMemoryPercent = totalMemPercent / podsWithGpu.length;
        totals.avgTemperature = totalTemp / podsWithGpu.length;
      }

      if (podsWithSys.length > 0) {
        let totalCpu = 0, totalSysMemPercent = 0;
        for (const pod of podsWithSys) {
          if (pod.system) {
            totalCpu += pod.system.cpuPercent;
            totals.totalSystemMemoryUsedMb += pod.system.memoryUsedMb;
            totals.totalSystemMemoryTotalMb += pod.system.memoryTotalMb;
            totalSysMemPercent += pod.system.memoryPercent;
          }
        }
        totals.avgCpuPercent = totalCpu / podsWithSys.length;
        totals.avgSystemMemoryPercent = totalSysMemPercent / podsWithSys.length;
      }

      return NextResponse.json(
        { pods: podMetrics, totals, timestamp: new Date().toISOString() } as AggregatedMetrics,
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    // Get all subscriptions and connection info
    const [subscriptions, connectionInfo] = await Promise.all([
      getPoolSubscriptions(teamId).catch(() => []),
      getConnectionInfo(teamId).catch(() => []),
    ]);

    // Filter to only active/subscribed pods (exclude terminated, unsubscribed, etc.)
    const runningSubscriptions = subscriptions.filter(
      (s) => {
        const status = s.status?.toLowerCase();
        // Only include actively running subscriptions
        return status === "subscribed" || status === "active" || status === "running";
      }
    );

    // Fetch metrics from each pod in parallel (with concurrency limit)
    const podMetricsPromises: Promise<PodGPUMetrics>[] = [];

    for (const sub of runningSubscriptions) {
      const subId = String(sub.id);
      const conn = connectionInfo.find((c) => String(c.id) === subId);
      // Prefer connectionInfo pod since it has SSH info
      const connPod = conn?.pods?.[0];
      const subPod = sub.pods?.[0];

      if (!connPod && !subPod) continue;

      const sshInfo = connPod?.ssh_info;
      const podName = connPod?.pod_name || subPod?.pod_name || `pod-${subId}`;
      const podStatus = connPod?.pod_status || subPod?.pod_status || sub.status;

      if (!sshInfo?.cmd || !sshInfo?.pass) {
        podMetricsPromises.push(
          Promise.resolve({
            subscriptionId: subId,
            podName,
            poolName: sub.pool_name || "Unknown",
            status: podStatus,
            gpu: null,
            system: null,
            error: "SSH credentials not available",
          })
        );
        continue;
      }

      // Skip non-running pods
      if (podStatus?.toLowerCase() !== "running") {
        podMetricsPromises.push(
          Promise.resolve({
            subscriptionId: subId,
            podName,
            poolName: sub.pool_name || "Unknown",
            status: podStatus,
            gpu: null,
            system: null,
            error: "Pod not running",
          })
        );
        continue;
      }

      const { host, port, username } = parseSSHInfo(sshInfo.cmd);
      const password = sshInfo.pass;
      // Get allocated RAM from subscription (ram_mb from per_pod_info)
      const allocatedRamMb = sub.per_pod_info?.ram_mb;

      podMetricsPromises.push(
        fetchPodMetrics(host, port, username, password, allocatedRamMb).then((metrics) => ({
          subscriptionId: subId,
          podName,
          poolName: sub.pool_name || "Unknown",
          status: podStatus,
          ...metrics,
        }))
      );
    }

    // Wait for all metrics (with timeout)
    const podMetrics = await Promise.all(podMetricsPromises);

    // Calculate aggregated totals
    const podsWithGpuMetrics = podMetrics.filter((p) => p.gpu !== null);
    const podsWithSystemMetrics = podMetrics.filter((p) => p.system !== null);
    const totals = {
      // GPU metrics
      avgUtilization: 0,
      totalMemoryUsed: 0,
      totalMemoryTotal: 0,
      avgMemoryPercent: 0,
      avgTemperature: 0,
      totalPowerDraw: 0,
      maxTemperature: 0,
      // System metrics
      avgCpuPercent: 0,
      totalSystemMemoryUsedMb: 0,
      totalSystemMemoryTotalMb: 0,
      avgSystemMemoryPercent: 0,
      // Counts
      activePods: podMetrics.filter((p) => p.status?.toLowerCase() === "running").length,
      podsWithMetrics: podsWithGpuMetrics.length,
    };

    // Calculate GPU totals
    if (podsWithGpuMetrics.length > 0) {
      let totalUtil = 0;
      let totalMemPercent = 0;
      let totalTemp = 0;

      for (const pod of podsWithGpuMetrics) {
        if (pod.gpu) {
          totalUtil += pod.gpu.utilization;
          totals.totalMemoryUsed += pod.gpu.memoryUsed;
          totals.totalMemoryTotal += pod.gpu.memoryTotal;
          totalMemPercent += pod.gpu.memoryPercent;
          totalTemp += pod.gpu.temperature;
          totals.totalPowerDraw += pod.gpu.powerDraw;
          if (pod.gpu.temperature > totals.maxTemperature) {
            totals.maxTemperature = pod.gpu.temperature;
          }
        }
      }

      totals.avgUtilization = totalUtil / podsWithGpuMetrics.length;
      totals.avgMemoryPercent = totalMemPercent / podsWithGpuMetrics.length;
      totals.avgTemperature = totalTemp / podsWithGpuMetrics.length;
    }

    // Calculate system totals
    if (podsWithSystemMetrics.length > 0) {
      let totalCpu = 0;
      let totalSysMemPercent = 0;

      for (const pod of podsWithSystemMetrics) {
        if (pod.system) {
          totalCpu += pod.system.cpuPercent;
          totals.totalSystemMemoryUsedMb += pod.system.memoryUsedMb;
          totals.totalSystemMemoryTotalMb += pod.system.memoryTotalMb;
          totalSysMemPercent += pod.system.memoryPercent;
        }
      }

      totals.avgCpuPercent = totalCpu / podsWithSystemMetrics.length;
      totals.avgSystemMemoryPercent = totalSysMemPercent / podsWithSystemMetrics.length;
    }

    const response: AggregatedMetrics = {
      pods: podMetrics,
      totals,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  } catch (err) {
    console.error("GPU hardware metrics error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
