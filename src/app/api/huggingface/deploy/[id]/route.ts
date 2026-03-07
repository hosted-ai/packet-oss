import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  getConnectionInfo,
  getPoolSubscriptions,
  unsubscribeFromPool,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import {
  generateDeployScript,
  getDefaultPort,
  DeployScriptType,
} from "@/lib/huggingface-deploy-scripts";
import { logActivity } from "@/lib/activity";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";

// Deployment timeout: 30 minutes from creation
const DEPLOYMENT_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum retry attempts for script execution
const MAX_SCRIPT_RETRIES = 2;

/**
 * Execute a script on a remote pod via SSH with retry logic
 */
async function executeRemoteScript(
  host: string,
  port: number,
  username: string,
  password: string,
  script: string,
  timeoutMs: number = 300000, // 5 minutes for model deployment
  retryCount: number = 0
): Promise<{ success: boolean; output: string; exitCode: number }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
    const encodedScript = Buffer.from(script).toString("base64");
    const remoteCommand = `echo '${encodedScript}' | base64 -d | bash`;

    // Use sshpass with SSHPASS env var (-e) to safely handle special characters in password
    const args = [
      "-e", // Use SSHPASS environment variable
      "ssh",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=30",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-p",
      String(port),
      `${username}@${host}`,
      remoteCommand,
    ];

    let stdout = "";
    let stderr = "";

    console.log(`[HF Deploy] Executing SSH script (attempt ${retryCount + 1}/${MAX_SCRIPT_RETRIES + 1})`);
    console.log(`[HF Deploy] SSH: ${username}@${host}:${port}`);

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

    proc.on("close", async (code) => {
      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");

      // If failed and we haven't exhausted retries, try again
      if (code !== 0 && retryCount < MAX_SCRIPT_RETRIES) {
        console.log(`[HF Deploy] Script execution failed (exit code ${code}), retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        const retryResult = await executeRemoteScript(host, port, username, password, script, timeoutMs, retryCount + 1);
        resolve(retryResult);
        return;
      }

      if (code === 0) {
        console.log("[HF Deploy] Script execution successful");
      } else {
        console.error(`[HF Deploy] Script execution failed with exit code ${code}`);
        console.error(`[HF Deploy] Output: ${output.slice(-500)}`);
      }

      resolve({
        success: code === 0,
        output,
        exitCode: code || 0,
      });
    });

    proc.on("error", async (err) => {
      console.error(`[HF Deploy] SSH process error: ${err.message}`);

      // Retry on connection errors
      if (retryCount < MAX_SCRIPT_RETRIES) {
        console.log(`[HF Deploy] Retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        const retryResult = await executeRemoteScript(host, port, username, password, script, timeoutMs, retryCount + 1);
        resolve(retryResult);
        return;
      }

      resolve({
        success: false,
        output: `Failed to execute: ${err.message}`,
        exitCode: -1,
      });
    });
  });
}

/**
 * Parse SSH command to extract connection details
 * Example: "ssh ubuntu@35.190.160.152 -p 31240"
 */
function parseSSHCommand(cmd: string): { host: string; port: number; username: string } {
  // Extract user@host
  const userHostMatch = cmd.match(/(\w+)@([^\s]+)/);
  const username = userHostMatch ? userHostMatch[1] : "ubuntu";
  const host = userHostMatch ? userHostMatch[2] : "localhost";

  // Extract port
  const portMatch = cmd.match(/-p\s+(\d+)/);
  const port = portMatch ? parseInt(portMatch[1], 10) : 22;

  return { host, port, username };
}

/**
 * Check if pod status indicates the pod is running
 * Handles case-insensitive comparison
 */
function isPodRunning(podStatus: string | undefined): boolean {
  if (!podStatus) return false;
  return podStatus.toLowerCase() === "running";
}

/**
 * Check if pod status indicates the pod has terminated
 */
function isPodTerminated(podStatus: string | undefined): boolean {
  if (!podStatus) return false;
  const status = podStatus.toLowerCase();
  return ["succeeded", "failed", "terminated", "error", "crashloopbackoff"].includes(status);
}

/**
 * Check if deployment has timed out
 */
function isDeploymentTimedOut(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > DEPLOYMENT_TIMEOUT_MS;
}

interface ConnectionInfo {
  host: string;
  port: number;
  username: string;
  password: string;
  podName: string;
  podStatus: string;
}

/**
 * GET /api/huggingface/deploy/[id]
 *
 * Get deployment status and execute script if pod is ready
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    const { id } = await params;

    // Get deployment record
    let deployment = await prisma.huggingFaceDeployment.findFirst({
      where: {
        id,
        stripeCustomerId: payload.customerId,
      },
    });

    if (!deployment) {
      return NextResponse.json(
        { error: "Deployment not found" },
        { status: 404 }
      );
    }

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Check for deployment timeout
    if (
      ["pending", "deploying"].includes(deployment.status) &&
      isDeploymentTimedOut(deployment.createdAt)
    ) {
      console.log(`[HF Deploy] Deployment ${id} timed out after 30 minutes`);

      deployment = await prisma.huggingFaceDeployment.update({
        where: { id },
        data: {
          status: "failed",
          errorMessage: "Deployment timed out after 30 minutes. The GPU may have failed to start or the model installation took too long.",
        },
      });

      await logActivity(
        payload.customerId,
        "hf_deployment_timeout",
        `HuggingFace deployment timed out: ${deployment.hfItemName}`,
        {
          deploymentId: id,
          hfItemId: deployment.hfItemId,
        }
      );
    }

    // Check subscription status
    let subscriptionStatus = "unknown";
    let connectionInfo: ConnectionInfo | null = null;
    let subscriptionError: string | null = null;

    try {
      const subscriptions = await getPoolSubscriptions(teamId);
      const sub = subscriptions.find(
        (s: { id: string }) => String(s.id) === String(deployment!.subscriptionId)
      );

      if (!sub) {
        subscriptionStatus = "not_found";
        console.log(`[HF Deploy] Subscription ${deployment!.subscriptionId} not found`);
      } else {
        subscriptionStatus = (sub as { status?: string; subscription_status?: string }).status ||
                            (sub as { status?: string; subscription_status?: string }).subscription_status ||
                            "unknown";
        console.log(`[HF Deploy] Subscription status: ${subscriptionStatus}`);
      }

      // Get connection info if subscribed
      if (subscriptionStatus === "subscribed" || subscriptionStatus === "active") {
        const connInfo = await getConnectionInfo(
          teamId,
          deployment!.subscriptionId
        );

        if (connInfo && connInfo.length > 0) {
          const subscription = connInfo.find(
            (s) => String(s.id) === String(deployment!.subscriptionId)
          );

          if (subscription?.pods && subscription.pods.length > 0) {
            const pod = subscription.pods[0];

            console.log(`[HF Deploy] Pod: ${pod.pod_name}, Status: ${pod.pod_status}`);

            if (pod.ssh_info?.cmd && pod.ssh_info?.pass) {
              const sshDetails = parseSSHCommand(pod.ssh_info.cmd);
              connectionInfo = {
                ...sshDetails,
                password: pod.ssh_info.pass,
                podName: pod.pod_name,
                podStatus: pod.pod_status,
              };
            } else {
              console.log("[HF Deploy] SSH info not available yet");
            }
          } else {
            console.log("[HF Deploy] No pods found in subscription");
          }
        }
      }
    } catch (error) {
      console.error("[HF Deploy] Error fetching subscription status:", error);
      subscriptionError = error instanceof Error ? error.message : "Unknown error";
    }

    // Handle pod termination
    if (
      connectionInfo &&
      isPodTerminated(connectionInfo.podStatus) &&
      deployment.status !== "failed"
    ) {
      console.log(`[HF Deploy] Pod terminated with status: ${connectionInfo.podStatus}`);

      deployment = await prisma.huggingFaceDeployment.update({
        where: { id },
        data: {
          status: "failed",
          errorMessage: `Pod terminated unexpectedly (${connectionInfo.podStatus}). Please delete this deployment and try again.`,
        },
      });

      await logActivity(
        payload.customerId,
        "hf_deployment_pod_terminated",
        `HuggingFace deployment pod terminated: ${deployment.hfItemName}`,
        {
          deploymentId: id,
          hfItemId: deployment.hfItemId,
          podStatus: connectionInfo.podStatus,
        }
      );
    }

    // If pending and pod is ready, run deploy script
    // CRITICAL: Use case-insensitive comparison for pod status
    if (
      deployment.status === "pending" &&
      connectionInfo &&
      isPodRunning(connectionInfo.podStatus)
    ) {
      console.log(`[HF Deploy] Pod is running, triggering deploy script for ${deployment.hfItemId}`);

      // Update status to deploying
      deployment = await prisma.huggingFaceDeployment.update({
        where: { id },
        data: { status: "deploying" },
      });

      const { searchParams } = new URL(request.url);
      const hfToken = searchParams.get("hfToken");

      const script = generateDeployScript(
        deployment.deployScript as DeployScriptType,
        {
          modelId:
            deployment.hfItemType !== "docker" ? deployment.hfItemId : undefined,
          dockerImage:
            deployment.hfItemType === "docker" ? deployment.hfItemId : undefined,
          port: deployment.servicePort || getDefaultPort(deployment.deployScript as DeployScriptType),
          hfToken: hfToken || undefined,
          openWebUI: deployment.openWebUI || false,
          netdata: deployment.netdata || false,
        }
      );

      console.log(`[HF Deploy] Executing deploy script via SSH to ${connectionInfo.username}@${connectionInfo.host}:${connectionInfo.port}`);

      const result = await executeRemoteScript(
        connectionInfo.host,
        connectionInfo.port,
        connectionInfo.username,
        connectionInfo.password,
        script
      );

      // The script starts vLLM in background and exits - success means script ran, not that vLLM is running
      // We set status to "deploying" and let deploy-status endpoint check actual vLLM status
      if (result.success) {
        console.log("[HF Deploy] Deploy script executed successfully, vLLM installation started");

        deployment = await prisma.huggingFaceDeployment.update({
          where: { id },
          data: {
            status: "deploying", // Keep as deploying - deploy-status will update to running when ready
            deployOutput: result.output.slice(-5000), // Keep last 5000 chars
          },
        });

        await logActivity(
          payload.customerId,
          "hf_deployment_script_started",
          `HuggingFace deployment script started: ${deployment.hfItemName}`,
          {
            deploymentId: id,
            hfItemId: deployment.hfItemId,
          }
        );
      } else {
        console.error(`[HF Deploy] Deploy script failed with exit code ${result.exitCode}`);

        deployment = await prisma.huggingFaceDeployment.update({
          where: { id },
          data: {
            status: "failed",
            deployOutput: result.output.slice(-5000),
            errorMessage: `Deploy script failed with exit code ${result.exitCode}. Check the logs for details.`,
          },
        });

        await logActivity(
          payload.customerId,
          "hf_deployment_script_failed",
          `HuggingFace deployment script failed: ${deployment.hfItemName}`,
          {
            deploymentId: id,
            hfItemId: deployment.hfItemId,
            exitCode: result.exitCode,
          }
        );
      }
    }

    // Build response
    const response: {
      deployment: {
        id: string;
        subscriptionId: string;
        hfItemId: string;
        hfItemName: string;
        hfItemType: string;
        deployScript: string;
        status: string;
        servicePort: number | null;
        openWebUI: boolean;
        webUiPort: number | null;
        netdata: boolean;
        netdataPort: number | null;
        deployOutput: string | null;
        errorMessage: string | null;
        createdAt: string;
        updatedAt: string;
      };
      subscription: {
        status: string;
        error?: string;
      };
      connection: {
        host: string;
        port: number;
        podName: string;
        podStatus: string;
        serviceUrl: string | null;
        webUiUrl: string | null;
        netdataUrl: string | null;
        sshCommand: string;
      } | null;
    } = {
      deployment: {
        id: deployment.id,
        subscriptionId: deployment!.subscriptionId,
        hfItemId: deployment.hfItemId,
        hfItemName: deployment.hfItemName,
        hfItemType: deployment.hfItemType,
        deployScript: deployment.deployScript,
        status: deployment.status,
        servicePort: deployment.servicePort,
        openWebUI: deployment.openWebUI || false,
        webUiPort: deployment.webUiPort,
        netdata: deployment.netdata || false,
        netdataPort: deployment.netdataPort,
        deployOutput: deployment.deployOutput,
        errorMessage: deployment.errorMessage,
        createdAt: deployment.createdAt.toISOString(),
        updatedAt: deployment.updatedAt.toISOString(),
      },
      subscription: {
        status: subscriptionStatus,
        ...(subscriptionError ? { error: subscriptionError } : {}),
      },
      connection: connectionInfo
        ? {
            host: connectionInfo.host,
            port: connectionInfo.port,
            podName: connectionInfo.podName,
            podStatus: connectionInfo.podStatus,
            serviceUrl:
              deployment.status === "running"
                ? `http://${connectionInfo.host}:${deployment.servicePort}`
                : null,
            webUiUrl:
              deployment.status === "running" && deployment.openWebUI
                ? `http://${connectionInfo.host}:${deployment.webUiPort || 3000}`
                : null,
            netdataUrl:
              deployment.status === "running" && deployment.netdata
                ? `http://${connectionInfo.host}:${deployment.netdataPort || 19999}`
                : null,
            sshCommand: `ssh ${connectionInfo.username}@${connectionInfo.host} -p ${connectionInfo.port}`,
          }
        : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[HF Deploy] Get deployment error:", error);
    return NextResponse.json(
      { error: "Failed to get deployment" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/huggingface/deploy/[id]
 *
 * Stop and delete a deployment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    const { id } = await params;

    // Get deployment record
    const deployment = await prisma.huggingFaceDeployment.findFirst({
      where: {
        id,
        stripeCustomerId: payload.customerId,
      },
    });

    if (!deployment) {
      return NextResponse.json(
        { error: "Deployment not found" },
        { status: 404 }
      );
    }

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    console.log(`[HF Deploy] Deleting deployment ${id} for ${deployment.hfItemName}`);

    // Unsubscribe from GPU pool
    try {
      const subscriptions = await getPoolSubscriptions(teamId);
      const sub = subscriptions.find(
        (s: { id: string }) => String(s.id) === String(deployment!.subscriptionId)
      );

      if (sub && sub.pool_id) {
        console.log(`[HF Deploy] Unsubscribing from pool ${sub.pool_id}`);
        await unsubscribeFromPool(
          deployment!.subscriptionId,
          teamId,
          sub.pool_id
        );
      }
    } catch (error) {
      console.error("[HF Deploy] Error unsubscribing:", error);
      // Continue with deleting the record even if unsubscribe fails
    }

    // Delete deployment record
    await prisma.huggingFaceDeployment.delete({
      where: { id },
    });

    await logActivity(
      payload.customerId,
      "hf_deployment_deleted",
      `Deleted HuggingFace deployment: ${deployment.hfItemName}`,
      {
        deploymentId: id,
        hfItemId: deployment.hfItemId,
      }
    );

    console.log(`[HF Deploy] Deployment ${id} deleted successfully`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[HF Deploy] Delete deployment error:", error);
    return NextResponse.json(
      { error: "Failed to delete deployment" },
      { status: 500 }
    );
  }
}
