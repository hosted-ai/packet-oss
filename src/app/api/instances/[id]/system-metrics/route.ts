/**
 * GET /api/instances/[id]/system-metrics
 * Fetches real-time GPU metrics from the pod via nvidia-smi
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getConnectionInfo } from "@/lib/hostedai";
import { spawn } from "child_process";
import Stripe from "stripe";
import { validateSSHParams } from "@/lib/ssh-validation";
import { prisma } from "@/lib/prisma";

interface SystemMetrics {
  gpu: {
    // Basic metrics (always available)
    utilization: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
    temperature: number;
    powerDraw: number;
    powerLimit: number;
    fanSpeed: number;
    // Advanced metrics (SM-level, may not be available on all GPUs)
    smActivity?: number;        // % of time SMs were active
    smOccupancy?: number;       // % of warps active vs max warps
    tensorActivity?: number;    // % of time tensor cores active
    memoryBandwidth?: number;   // % of memory bandwidth used
    pcieRxBandwidth?: number;   // PCIe receive bandwidth (MB/s)
    pcieTxBandwidth?: number;   // PCIe transmit bandwidth (MB/s)
    // Efficiency score (computed)
    efficiencyScore?: number;   // Computed: smActivity / utilization ratio
    efficiencyAlert?: string;   // Alert message if efficiency is low
  } | null;
}

/**
 * Execute a command on a remote pod via SSH
 */
async function executeSSHCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs: number = 30000
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
      resolve({
        success: code === 0,
        output: stdout + (stderr ? `\nSTDERR: ${stderr}` : ""),
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        output: `Failed to execute: ${err.message}`,
      });
    });
  });
}

/**
 * Parse SSH host from command like "ssh root@192.168.1.1 -p 22"
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: subscriptionId } = await params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // === DB MODE: Read metrics from GpuHardwareMetrics table (no SSH) ===
    if (process.env.GPU_METRICS_SOURCE === "db") {
      // Verify subscription belongs to this customer
      const podMeta = await prisma.podMetadata.findFirst({
        where: { subscriptionId, stripeCustomerId: payload.customerId },
      });
      if (!podMeta) {
        return NextResponse.json({ error: "Instance not found" }, { status: 404 });
      }

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const latest = await prisma.gpuHardwareMetrics.findFirst({
        where: {
          subscriptionId,
          timestamp: { gte: fiveMinAgo },
        },
        orderBy: { timestamp: "desc" },
      });

      const metrics: SystemMetrics = {
        gpu: latest
          ? {
              utilization: latest.gpuUtilization,
              memoryUsed: latest.memoryUsedMb,
              memoryTotal: latest.memoryTotalMb,
              memoryPercent: latest.memoryPercent,
              temperature: latest.temperature,
              powerDraw: latest.powerDraw,
              powerLimit: latest.powerLimit,
              fanSpeed: latest.fanSpeed,
            }
          : null,
      };

      return NextResponse.json({
        subscriptionId,
        metrics,
        timestamp: latest?.timestamp.toISOString() || new Date().toISOString(),
      });
    }

    // Get team ID from Stripe customer
    const stripe = getStripe();
    const customerResult = await stripe.customers.retrieve(payload.customerId);
    if ("deleted" in customerResult && customerResult.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = customerResult as Stripe.Customer;
    const teamId = (customer.metadata?.team_id || customer.metadata?.teamId || customer.metadata?.hostedai_team_id) as string;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with account" }, { status: 400 });
    }

    // Get connection info for this subscription
    const connectionInfo = await getConnectionInfo(teamId);
    const connInfo = connectionInfo.find((c) => String(c.id) === String(subscriptionId));

    if (!connInfo?.pods?.[0]) {
      return NextResponse.json({ error: "Instance not found or not running" }, { status: 404 });
    }

    const pod = connInfo.pods[0];
    const sshInfo = pod.ssh_info;

    if (!sshInfo?.cmd || !sshInfo?.pass) {
      return NextResponse.json({ error: "SSH credentials not available" }, { status: 400 });
    }

    const { host, port, username } = parseSSHInfo(sshInfo.cmd);
    const password = sshInfo.pass;

    // Get GPU metrics via nvidia-smi (basic + advanced SM metrics)
    // We run two queries: basic metrics + dmon for SM-level metrics
    const metricsCommand = `
      # Basic GPU metrics
      BASIC=$(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed --format=csv,noheader,nounits 2>/dev/null)
      echo "BASIC=$BASIC"

      # Advanced SM metrics via dmon (single sample, 100ms)
      # Columns: gpu sm mem enc dec mclk pclk - we want sm (SM activity %)
      DMON=$(nvidia-smi dmon -s u -c 1 2>/dev/null | tail -1 | awk '{print $2,$3}')
      echo "DMON=$DMON"

      # Memory bandwidth utilization via nvidia-smi (if available)
      MEMBW=$(nvidia-smi --query-gpu=utilization.memory --format=csv,noheader,nounits 2>/dev/null)
      echo "MEMBW=$MEMBW"

      # PCIe throughput (rx/tx in MB/s)
      PCIE=$(nvidia-smi --query-gpu=pcie.link.gen.current,pcie.link.width.current --format=csv,noheader,nounits 2>/dev/null)
      echo "PCIE=$PCIE"

      # Try to get tensor core activity via DCGM if available
      if command -v dcgmi &> /dev/null; then
        TENSOR=$(dcgmi dmon -e 1004 -c 1 2>/dev/null | tail -1 | awk '{print $2}')
        echo "TENSOR=$TENSOR"
      fi
    `;

    const result = await executeSSHCommand(host, port, username, password, metricsCommand);

    if (!result.success) {
      console.error("Failed to fetch system metrics:", result.output);
      return NextResponse.json(
        { error: "Failed to fetch metrics from pod", details: result.output },
        { status: 500 }
      );
    }

    // Parse output
    const output = result.output;
    const metrics: SystemMetrics = {
      gpu: null,
    };


    // Parse basic metrics
    const basicMatch = output.match(/BASIC=([^\n]+)/);
    if (basicMatch && basicMatch[1].trim()) {
      const values = basicMatch[1].split(",").map(v => {
        const parsed = parseFloat(v.trim());
        return isNaN(parsed) ? 0 : parsed;
      });

      if (values.length >= 6) {
        const utilization = values[0] || 0;

        metrics.gpu = {
          utilization,
          memoryUsed: values[1] || 0,
          memoryTotal: values[2] || 0,
          memoryPercent: values[2] ? (values[1] / values[2]) * 100 : 0,
          temperature: values[3] || 0,
          powerDraw: values[4] || 0,
          powerLimit: values[5] || 0,
          fanSpeed: values[6] || 0,
        };

        // Parse SM activity from dmon (sm = streaming multiprocessor activity %)
        const dmonMatch = output.match(/DMON=(\d+)\s+(\d+)/);
        if (dmonMatch) {
          metrics.gpu.smActivity = parseInt(dmonMatch[1]) || 0;
          // dmon column 3 is memory controller activity, use as proxy for memory bandwidth
          const memActivity = parseInt(dmonMatch[2]) || 0;
          metrics.gpu.memoryBandwidth = memActivity;
        }

        // Parse memory bandwidth utilization
        const membwMatch = output.match(/MEMBW=(\d+)/);
        if (membwMatch && !metrics.gpu.memoryBandwidth) {
          metrics.gpu.memoryBandwidth = parseInt(membwMatch[1]) || 0;
        }

        // Parse tensor activity from DCGM if available
        const tensorMatch = output.match(/TENSOR=(\d+)/);
        if (tensorMatch) {
          metrics.gpu.tensorActivity = parseInt(tensorMatch[1]) || 0;
        }

        // Calculate efficiency score and generate alerts
        // High utilization + low SM activity = communication/memory bound workload
        if (metrics.gpu.smActivity !== undefined && utilization > 0) {
          const efficiency = metrics.gpu.smActivity / utilization;
          metrics.gpu.efficiencyScore = Math.round(efficiency * 100);

          // Generate alert if utilization is high but SM activity is low
          if (utilization >= 80 && metrics.gpu.smActivity < 30) {
            metrics.gpu.efficiencyAlert = "Your GPU shows high utilization but low compute activity. This often indicates a communication or memory bottleneck.";
          } else if (utilization >= 50 && efficiency < 0.3) {
            metrics.gpu.efficiencyAlert = "GPU efficiency is low. Your workload may be I/O or communication bound rather than compute bound.";
          }
        }
      }
    }

    return NextResponse.json({
      subscriptionId,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("System metrics error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
