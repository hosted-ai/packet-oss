/**
 * Admin Pods Metrics API
 *
 * Fetches real-time GPU metrics for specific pods via SSH.
 * This is a separate endpoint because fetching metrics is expensive.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";

interface GPUMetrics {
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
}

interface PodMetricsResult {
  subscriptionId: string;
  gpu: GPUMetrics | null;
  error?: string;
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
      "-o", "ConnectTimeout=8",
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
 * Fetch GPU metrics from a single pod via SSH using nvidia-smi
 */
async function fetchPodGPUMetrics(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<GPUMetrics | null> {
  const metricsCommand = `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits 2>/dev/null`;

  const result = await executeSSHCommand(host, port, username, password, metricsCommand);

  if (!result.success) {
    return null;
  }

  const output = result.output.trim();
  const values = output.split(",").map(v => parseFloat(v.trim()));

  if (values.length >= 5 && !values.some(isNaN)) {
    return {
      utilization: values[0] || 0,
      memoryUsed: values[1] || 0,
      memoryTotal: values[2] || 0,
      memoryPercent: values[2] ? (values[1] / values[2]) * 100 : 0,
      temperature: values[3] || 0,
      powerDraw: values[4] || 0,
    };
  }

  return null;
}

export async function POST(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pods } = body as {
      pods: Array<{
        subscriptionId: string;
        ssh: {
          host: string;
          port: number;
          username: string;
          password: string;
        };
      }>;
    };

    if (!pods || !Array.isArray(pods) || pods.length === 0) {
      return NextResponse.json({ error: "No pods provided" }, { status: 400 });
    }

    // Limit to 20 pods at a time to avoid overwhelming the server
    const limitedPods = pods.slice(0, 20);

    // Fetch metrics in parallel with concurrency limit
    const results: PodMetricsResult[] = await Promise.all(
      limitedPods.map(async (pod) => {
        if (!pod.ssh) {
          return {
            subscriptionId: pod.subscriptionId,
            gpu: null,
            error: "No SSH credentials",
          };
        }

        try {
          const gpu = await fetchPodGPUMetrics(
            pod.ssh.host,
            pod.ssh.port,
            pod.ssh.username,
            pod.ssh.password
          );

          return {
            subscriptionId: pod.subscriptionId,
            gpu,
            error: gpu ? undefined : "Failed to fetch metrics",
          };
        } catch (err) {
          return {
            subscriptionId: pod.subscriptionId,
            gpu: null,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    return NextResponse.json({
      metrics: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin pods metrics error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch metrics";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
