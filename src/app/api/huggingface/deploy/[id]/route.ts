import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";
import {
  getUnifiedInstances,
  deleteInstance,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import {
  generateDeployScript,
  getDefaultPort,
  DeployScriptType,
} from "@/lib/huggingface-deploy-scripts";
import { logActivity } from "@/lib/activity";
import {
  executeRemoteScript,
  getSSHCredentials,
  type SSHCredentials,
} from "@/lib/huggingface-status";

// Deployment timeout: 30 minutes from creation
const DEPLOYMENT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Check if pod status indicates the pod is running (HAI 2.2 uses lowercase "running")
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

interface ConnectionInfo extends SSHCredentials {
  podName: string;
  podStatus: string;
}

/**
 * GET /api/huggingface/deploy/[id]
 *
 * Get deployment status and execute script if pod is ready.
 * Uses HAI 2.2 unified instances and instance credentials API.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { accountId, teamId } = auth;

    // PA-202 gate: Hugging Face hidden from Read-only Member + Finance Manager.
    const denial = requirePermission(auth, "huggingface.use", request);
    if (denial) return denial;

    const { id } = await params;

    // Scoped on the operating account, as the collection route is, so a member
    // operating a team reaches the deployment their list already shows.
    let deployment = await prisma.huggingFaceDeployment.findFirst({
      where: {
        id,
        stripeCustomerId: accountId,
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
        accountId,
        "hf_deployment_timeout",
        `HuggingFace deployment timed out: ${deployment.hfItemName}`,
        {
          deploymentId: id,
          hfItemId: deployment.hfItemId,
        }
      );
    }

    // HAI 2.2: Look up the instance directly by the stored instance ID
    const instanceId = deployment.subscriptionId;
    let subscriptionStatus = "unknown";
    let connectionInfo: ConnectionInfo | null = null;
    let subscriptionError: string | null = null;

    try {
      const instancesResult = await getUnifiedInstances(teamId);
      const instance = instancesResult.items.find(i => i.id === instanceId);

      if (!instance) {
        subscriptionStatus = "not_found";
        console.log(`[HF Deploy] Instance ${instanceId} not found`);
      } else {
        subscriptionStatus = (instance.status || "unknown").toLowerCase();
        console.log(`[HF Deploy] Instance status: ${subscriptionStatus}`);

        // Get SSH credentials if instance is running
        if (isPodRunning(instance.status)) {
          const creds = await getSSHCredentials(instance.id);
          if (creds) {
            connectionInfo = {
              ...creds,
              podName: instance.name || instance.id,
              podStatus: instance.status || "unknown",
            };
            console.log(`[HF Deploy] Pod: ${connectionInfo.podName}, Status: ${connectionInfo.podStatus}`);
          } else {
            console.log("[HF Deploy] SSH credentials not available yet");
          }
        }
      }
    } catch (error) {
      console.error("[HF Deploy] Error fetching instance status:", error);
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
        accountId,
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

      if (result.success) {
        console.log("[HF Deploy] Deploy script executed successfully, vLLM installation started");

        deployment = await prisma.huggingFaceDeployment.update({
          where: { id },
          data: {
            status: "deploying",
            deployOutput: result.output.slice(-5000),
          },
        });

        await logActivity(
          accountId,
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
          accountId,
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
        subscriptionId: deployment.subscriptionId,
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
 * Stop and delete a deployment. Deletes the HAI 2.2 instance directly.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { accountId, teamId } = auth;

    // PA-202 gate: Hugging Face hidden from Read-only Member + Finance Manager.
    const denial = requirePermission(auth, "huggingface.use", request);
    if (denial) return denial;

    const { id } = await params;

    // Scoped on the operating account, as the collection route is, so a member
    // operating a team can delete the deployment their list already shows.
    const deployment = await prisma.huggingFaceDeployment.findFirst({
      where: {
        id,
        stripeCustomerId: accountId,
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

    // Delete the HAI 2.2 instance directly by the stored instance ID
    try {
      console.log(`[HF Deploy] Deleting instance ${deployment.subscriptionId}`);
      await deleteInstance(deployment.subscriptionId);
    } catch (error) {
      console.error("[HF Deploy] Error deleting instance:", error);
      // Continue with deleting the record even if instance delete fails
    }

    // Delete deployment record
    await prisma.huggingFaceDeployment.delete({
      where: { id },
    });

    await logActivity(
      accountId,
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
