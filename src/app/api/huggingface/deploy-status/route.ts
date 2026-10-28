import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";
import { getUnifiedInstances } from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import { sendHfDeploymentEmail } from "@/lib/email";
import { createLoginLink } from "@/lib/customer-auth";
import { logActivity } from "@/lib/activity";
import {
  generateDeployScript,
  getDefaultPort,
} from "@/lib/huggingface-deploy-scripts";
import { getCatalogItem, DeployScriptType } from "@/lib/huggingface-catalog";
import {
  executeRemoteCommand,
  executeRemoteScript,
  parseStatusOutput,
  getSSHCredentials,
  ERROR_MESSAGES,
  STATUS_CHECK_SCRIPT,
  type DeploymentStatus,
  type SSHCredentials,
} from "@/lib/huggingface-status";

// Track in-flight deploy triggers to prevent duplicate script executions
const deployTriggersInFlight = new Set<string>();

// Simple view - what most users need
interface SimpleStatus {
  status: DeploymentStatus;
  message: string;
  progressPercent?: number; // 0-100
  error?: string; // Error code for quick identification
}

// Advanced view - for power users
interface AdvancedStatus {
  logs: string;
  sshCommand?: string;
  apiEndpoint?: string;
  podName?: string;
  podStatus?: string;
  startedAt?: string;
  elapsedSeconds?: number;
  errorCode?: string;
  gpuInfo?: {
    memoryUsedMB?: number;
    memoryTotalMB?: number;
    utilization?: number;
  };
  modelInfo?: {
    modelId?: string;
    modelSize?: string;
    loadProgress?: string;
  };
}

interface StatusResponse extends SimpleStatus {
  // Top-level fields consumed by frontends (HuggingFaceTab, ProgressModal, GPUCard)
  logs?: string;
  apiEndpoint?: string;
  // Detailed view for power users / SSH terminal
  advanced?: AdvancedStatus;
}

/**
 * Trigger the deploy script on a running instance via SSH.
 * Fire-and-forget: runs in background, updates DB on completion.
 */
function triggerDeployScript(
  instanceId: string,
  deployment: { id: string; hfItemId: string; hfItemType: string; hfItemName: string; deployScript: string; servicePort: number | null; hfToken: string | null; openWebUI: boolean; netdata: boolean },
  creds: SSHCredentials
) {
  if (deployTriggersInFlight.has(instanceId)) return;
  deployTriggersInFlight.add(instanceId);

  console.log(`[HF Status] Triggering deploy script for ${deployment.hfItemName} (deployment ${deployment.id})`);

  (async () => {
    try {
      const catalogItem = getCatalogItem(deployment.hfItemId);
      const deployScriptType = deployment.deployScript as DeployScriptType;

      const script = generateDeployScript(deployScriptType, {
        modelId: deployment.hfItemType !== "docker" ? deployment.hfItemId : undefined,
        dockerImage: catalogItem?.dockerImage,
        port: deployment.servicePort || getDefaultPort(deployScriptType),
        hfToken: deployment.hfToken || undefined,
        gpuCount: 1,
        openWebUI: deployment.openWebUI || false,
        netdata: deployment.netdata || false,
      });

      await prisma.huggingFaceDeployment.update({
        where: { id: deployment.id },
        data: { status: "deploying", errorMessage: null },
      });

      const scriptResult = await executeRemoteScript(
        creds.host, creds.port, creds.username, creds.password, script,
      );

      if (scriptResult.success) {
        console.log(`[HF Status] Deploy script started successfully for ${deployment.hfItemName}`);
        await prisma.huggingFaceDeployment.update({
          where: { id: deployment.id },
          data: { status: "deploying", deployOutput: scriptResult.output.slice(-5000) },
        });
      } else {
        console.error(`[HF Status] Deploy script failed (exit ${scriptResult.exitCode}): ${scriptResult.output.slice(-500)}`);
        await prisma.huggingFaceDeployment.update({
          where: { id: deployment.id },
          data: {
            status: "failed",
            errorMessage: `Deploy script failed with exit code ${scriptResult.exitCode}`,
            deployOutput: scriptResult.output.slice(-5000),
          },
        });
      }
    } catch (triggerErr) {
      console.error(`[HF Status] Deploy trigger error:`, triggerErr);
    } finally {
      deployTriggersInFlight.delete(instanceId);
    }
  })();
}

/**
 * GET /api/huggingface/deploy-status
 *
 * Query params:
 * - subscriptionId: HAI 2.2 instance ID
 *
 * Returns deployment status by checking install.log and vLLM server status
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, customer, teamId, accountId } = auth;

    // PA-202 gate: Hugging Face hidden from Read-only Member + Finance Manager.
    const denial = requirePermission(auth, "huggingface.use", request);
    if (denial) return denial;

    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get("subscriptionId");

    if (!instanceId) {
      return NextResponse.json(
        { error: "subscriptionId is required" },
        { status: 400 }
      );
    }

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // HAI 2.2: Verify instance belongs to this team
    const unifiedResult = await getUnifiedInstances(teamId);
    const instance = unifiedResult.items?.find(i => i.id === instanceId);

    if (!instance) {
      console.log(`[HF Status] Instance ${instanceId} not found for team ${teamId}`);
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    const instanceStatus = instance.status?.toLowerCase() || "";

    // Instance has terminated
    if (["succeeded", "failed", "terminated", "error", "crashloopbackoff"].includes(instanceStatus)) {
      console.log(`[HF Status] Instance ${instanceId} terminated with status: ${instance.status}`);

      const deployment = await prisma.huggingFaceDeployment.findFirst({
        where: { subscriptionId: instanceId },
        orderBy: { createdAt: "desc" },
      });

      if (deployment && deployment.status !== "failed") {
        await prisma.huggingFaceDeployment.update({
          where: { id: deployment.id },
          data: {
            status: "failed",
            errorMessage: `Pod terminated unexpectedly (${instance.status}). Please terminate this GPU and launch a new one.`,
          },
        });

        await logActivity(
          accountId,
          "hf_deployment_pod_terminated",
          `HuggingFace deployment pod terminated: ${deployment.hfItemName}`,
          { deploymentId: deployment.id, podStatus: instance.status }
        );
      }

      return NextResponse.json<StatusResponse>({
        status: "failed",
        message: `Pod terminated unexpectedly (${instance.status}). Please terminate this GPU and launch a new one.`,
        error: "POD_TERMINATED",
      });
    }

    // Instance is not running yet
    if (instanceStatus !== "running") {
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: `Pod status: ${instance.status}. Waiting for it to start...`,
      });
    }

    // HAI 2.2: Get SSH credentials via instance credentials API
    // Use 0 retries since this endpoint is polled every 5s — implicit retry via polling
    const creds = await getSSHCredentials(instanceId, 0);

    if (!creds) {
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: "Pod is running, waiting for SSH access...",
      });
    }

    // DEPLOY TRIGGER: Check if there's a pending deployment that needs its script kicked off.
    // This runs BEFORE the SSH status check so that an SSH status-check failure
    // doesn't block the deploy trigger indefinitely. The trigger fires once
    // (guarded by deployTriggersInFlight) and the next poll will pick up the status.
    // Retrigger eligibility: pending/failed always; "deploying" only if stale
    // (>10min since last update — longer than the 5min script timeout, so we
    // never restart an actively-running deploy). The install.log probe below
    // is the real guard against retriggering a successful deploy.
    const STALE_DEPLOYING_MS = 10 * 60 * 1000;
    const pendingDeployment = await prisma.huggingFaceDeployment.findFirst({
      where: {
        subscriptionId: instanceId,
        OR: [
          { status: { in: ["pending", "failed"] } },
          {
            status: "deploying",
            updatedAt: { lt: new Date(Date.now() - STALE_DEPLOYING_MS) },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (pendingDeployment && !deployTriggersInFlight.has(instanceId)) {
      // Only trigger if deploy hasn't been started yet — check for install.log via a quick SSH probe
      try {
        const probe = await executeRemoteCommand(
          creds.host, creds.port, creds.username, creds.password,
          `test -f "$HOME/hf-workspace/install.log" && echo "EXISTS" || echo "MISSING"`,
          10000
        );
        if (probe.success && probe.output.includes("MISSING")) {
          triggerDeployScript(instanceId, pendingDeployment, creds);
        }
      } catch {
        // Probe failed — deploy trigger will retry on next poll
      }
    }

    // Check status by examining install.log and server status
    const statusCommand = STATUS_CHECK_SCRIPT + `
      # Get GPU info for advanced view (if nvidia-smi available)
      echo "---GPUINFO---"
      if command -v nvidia-smi &> /dev/null; then
        nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 || echo "N/A"
      else
        echo "N/A"
      fi

      # Get model loading progress from vLLM log
      echo "---MODELINFO---"
      if [ -f "$WORKSPACE/vllm.log" ]; then
        grep -E "Loading model|Downloading|Loading weights|Model loaded" "$WORKSPACE/vllm.log" 2>/dev/null | tail -1 || echo "N/A"
      else
        echo "N/A"
      fi

      # Show recent logs
      echo "---LOGS---"
      if [ -f "$WORKSPACE/vllm.log" ] && [ -s "$WORKSPACE/vllm.log" ]; then
        tail -30 "$WORKSPACE/vllm.log" 2>/dev/null
      else
        tail -25 "$WORKSPACE/install.log" 2>/dev/null
      fi
    `;

    const result = await executeRemoteCommand(
      creds.host,
      creds.port,
      creds.username,
      creds.password,
      statusCommand
    );

    if (!result.success) {
      console.log(`[HF Status] SSH status check failed for ${instance.name}: ${result.output.slice(-200)}`);
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: "Connecting to GPU... (SSH may still be starting)",
        error: result.output.slice(-500),
      });
    }

    // Parse output
    const { status, progressPercent, errorType } = parseStatusOutput(result.output);

    // Parse GPU info
    const gpuInfoStart = result.output.indexOf("---GPUINFO---");
    const gpuInfoEnd = result.output.indexOf("---MODELINFO---");
    let gpuInfo: { memoryUsedMB?: number; memoryTotalMB?: number; utilization?: number } | undefined;
    if (gpuInfoStart > -1 && gpuInfoEnd > -1) {
      const gpuLine = result.output.slice(gpuInfoStart + 13, gpuInfoEnd).trim();
      if (gpuLine && gpuLine !== "N/A") {
        const parts = gpuLine.split(",").map(s => s.trim());
        if (parts.length >= 3) {
          gpuInfo = {
            memoryUsedMB: parseInt(parts[0], 10) || undefined,
            memoryTotalMB: parseInt(parts[1], 10) || undefined,
            utilization: parseInt(parts[2], 10) || undefined,
          };
        }
      }
    }

    // Parse model info
    const modelInfoStart = result.output.indexOf("---MODELINFO---");
    const logsStart = result.output.indexOf("---LOGS---");
    let modelLoadProgress: string | undefined;
    if (modelInfoStart > -1 && logsStart > -1) {
      const modelLine = result.output.slice(modelInfoStart + 15, logsStart).trim();
      if (modelLine && modelLine !== "N/A") {
        modelLoadProgress = modelLine;
      }
    }

    const logs = logsStart > -1 ? result.output.slice(logsStart + 10).trim() : "";

    // Build response with specific messages
    const statusMessages: Record<DeploymentStatus, string> = {
      not_started: "Deployment not started yet. Initializing...",
      installing: "Installing vLLM and dependencies... (5-10 minutes)",
      downloading: "Downloading model from HuggingFace... (depends on model size)",
      install_complete: "Installation complete, starting model server...",
      starting: "Loading model into GPU memory... (may take a few minutes)",
      running: "Model is running and ready to accept requests!",
      failed: "Deployment failed",
    };

    let message = statusMessages[status] || "Unknown status";
    if (status === "failed" && errorType && ERROR_MESSAGES[errorType]) {
      message = ERROR_MESSAGES[errorType];
    }

    // Get deployment record for additional info
    const deployment = await prisma.huggingFaceDeployment.findFirst({
      where: { subscriptionId: instanceId },
      orderBy: { createdAt: "desc" },
    });

    // Calculate elapsed time
    const elapsedSeconds = deployment
      ? Math.floor((Date.now() - deployment.createdAt.getTime()) / 1000)
      : undefined;

    // Build response with simple and advanced views
    const truncatedLogs = logs.slice(-3000);
    const apiEndpoint = status === "running" ? `http://localhost:8000/v1` : undefined;

    const response: StatusResponse = {
      status,
      message,
      progressPercent,
      error: errorType,

      // Top-level for frontend consumption
      logs: truncatedLogs || undefined,
      apiEndpoint,

      // Detailed view
      advanced: {
        logs: truncatedLogs,
        sshCommand: `ssh ${creds.username}@${creds.host} -p ${creds.port}`,
        apiEndpoint,
        podName: instance.name,
        podStatus: instance.status,
        startedAt: deployment?.createdAt?.toISOString(),
        elapsedSeconds,
        errorCode: errorType,
        gpuInfo,
        modelInfo: {
          modelId: deployment?.hfItemId,
          loadProgress: modelLoadProgress,
        },
      },
    };

    // Update database and send email if status has changed to final state
    if ((status === "running" || status === "failed") && deployment) {
      try {
        if (deployment.status !== status) {
          const previousStatus = deployment.status;
          console.log(`[HF Status] Updating deployment ${deployment.id}: ${previousStatus} -> ${status}`);

          await prisma.huggingFaceDeployment.update({
            where: { id: deployment.id },
            data: {
              status: status === "running" ? "running" : "failed",
              errorMessage: status === "failed" ? message : null,
            },
          });

          await logActivity(
            accountId,
            status === "running" ? "hf_deployment_running" : "hf_deployment_failed",
            `HuggingFace deployment ${status}: ${deployment.hfItemName}`,
            {
              deploymentId: deployment.id,
              hfItemId: deployment.hfItemId,
              errorType: errorType,
            }
          );

          // Send email when transitioning from in-progress state
          const wasInProgress = ["pending", "installing", "starting", "deploying", "downloading"].includes(previousStatus);
          if (wasInProgress && customer.email) {
            try {
              const dashboardToken = await createLoginLink({ email: payload.email.toLowerCase(), customerId: accountId });
              const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;

              await sendHfDeploymentEmail({
                to: customer.email,
                customerName: customer.name || customer.email.split("@")[0],
                modelName: deployment.hfItemName,
                status: status === "running" ? "success" : "failed",
                errorMessage: status === "failed" ? message : undefined,
                dashboardUrl,
              });

              console.log(`[HF Status] Sent deployment email to ${customer.email} for ${deployment.hfItemName} (${status})`);
            } catch (emailError) {
              console.error("[HF Status] Failed to send email:", emailError);
            }
          }
        }
      } catch (dbError) {
        console.error("[HF Status] Failed to update database:", dbError);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[HF Status] Error:", error);
    return NextResponse.json(
      { error: "Failed to get deployment status" },
      { status: 500 }
    );
  }
}
