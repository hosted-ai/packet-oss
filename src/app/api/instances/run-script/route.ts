import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getConnectionInfo } from "@/lib/hostedai";
import { spawn } from "child_process";
import Stripe from "stripe";
import { validateSSHParams } from "@/lib/ssh-validation";

// Parse SSH command to extract host and port
function parseSSHCommand(cmd: string): { host: string; port: number; username: string } {
  const parts = cmd.trim().split(/\s+/);

  const userHostPart = parts.find(p => p.includes("@"));
  if (!userHostPart) {
    throw new Error("Invalid SSH command format - missing user@host");
  }

  const [username, host] = userHostPart.split("@");

  let port = 22;
  const portFlagIndex = parts.indexOf("-p");
  if (portFlagIndex !== -1 && parts[portFlagIndex + 1]) {
    port = parseInt(parts[portFlagIndex + 1], 10);
  }

  return { host, port, username };
}

// Execute a bash script on the remote VM via SSH
async function executeScript(
  host: string,
  port: number,
  username: string,
  password: string,
  script: string,
  timeoutMs: number = 60000
): Promise<{ success: boolean; output: string; exitCode: number }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve, reject) => {
    // Escape the script for passing to bash -c
    // We base64 encode to avoid shell escaping issues
    const encodedScript = Buffer.from(script).toString("base64");
    const remoteCommand = `echo '${encodedScript}' | base64 -d | bash`;

    // Use sshpass with SSHPASS env var (-e) to safely handle special characters in password
    const args = [
      "-e",  // Use SSHPASS environment variable
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=20",
      "-p", String(port),
      `${username}@${host}`,
      remoteCommand
    ];

    console.log(`Executing script on ${username}@${host}:${port}`);

    const proc = spawn("sshpass", args, {
      timeout: timeoutMs,
      env: { ...process.env, SSHPASS: password },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      console.log("Script execution result - code:", code);

      // Combine stdout and stderr for output (stderr often contains progress info)
      const output = stdout + (stderr ? "\n" + stderr : "");

      resolve({
        success: code === 0,
        output: output.trim(),
        exitCode: code ?? -1
      });
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("sshpass not available on server - please contact support"));
      } else {
        reject(err);
      }
    });

    // Handle timeout
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Script execution timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });
}

// POST - Run a bash script on a pod
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { script, subscriptionId, podName, timeout } = await request.json();

    if (!script || typeof script !== "string") {
      return NextResponse.json(
        { error: "Script is required" },
        { status: 400 }
      );
    }

    if (script.length > 100000) {
      return NextResponse.json(
        { error: "Script is too large (max 100KB)" },
        { status: 400 }
      );
    }

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "Subscription ID is required" },
        { status: 400 }
      );
    }

    // Get customer to find team ID
    const stripe = await getStripe();
    const customer = (await stripe.customers.retrieve(
      payload.customerId
    )) as Stripe.Customer;

    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Get connection info from hosted.ai
    const connectionInfo = await getConnectionInfo(teamId, subscriptionId);

    if (!connectionInfo || connectionInfo.length === 0) {
      return NextResponse.json(
        { error: "No connection info available for this subscription" },
        { status: 400 }
      );
    }

    // Find the subscription
    const subscription = connectionInfo.find(
      (s) => String(s.id) === String(subscriptionId)
    );

    if (!subscription || !subscription.pods || subscription.pods.length === 0) {
      return NextResponse.json(
        { error: "No pods available for this subscription" },
        { status: 400 }
      );
    }

    // Find the target pod
    let targetPod = subscription.pods[0];
    if (podName) {
      const found = subscription.pods.find((p) => p.pod_name === podName);
      if (found) {
        targetPod = found;
      }
    }

    if (!targetPod.ssh_info) {
      return NextResponse.json(
        { error: "SSH info not available for this pod" },
        { status: 400 }
      );
    }

    const { cmd, pass } = targetPod.ssh_info;
    if (!cmd || !pass) {
      return NextResponse.json(
        { error: "SSH credentials not available" },
        { status: 400 }
      );
    }

    // Parse the SSH command
    const { host, port, username } = parseSSHCommand(cmd);

    console.log(`Running script on ${host}:${port} for pod ${targetPod.pod_name}`);

    // Execute the script with configurable timeout (default 60s, max 5min)
    const timeoutMs = Math.min(Math.max((timeout || 60) * 1000, 5000), 300000);
    const result = await executeScript(host, port, username, pass, script, timeoutMs);

    return NextResponse.json({
      success: result.success,
      output: result.output,
      exitCode: result.exitCode,
      pod: targetPod.pod_name,
    });
  } catch (error) {
    console.error("Run script error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to run script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
