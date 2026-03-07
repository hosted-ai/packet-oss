import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getConnectionInfo, getPoolSubscriptions } from "@/lib/hostedai";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";
import { sendHfDeploymentEmail } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import { logActivity } from "@/lib/activity";
import { validateSSHParams } from "@/lib/ssh-validation";

// Maximum retry attempts for SSH commands
const MAX_SSH_RETRIES = 2;

/**
 * Execute a quick command on a remote pod via SSH with retry logic
 */
async function executeRemoteCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs: number = 20000,
  retryCount: number = 0
): Promise<{ success: boolean; output: string }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
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
      "ConnectTimeout=15",
      "-o",
      "ServerAliveInterval=10",
      "-o",
      "ServerAliveCountMax=2",
      "-p",
      String(port),
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

    proc.on("close", async (code) => {
      // Retry on failure
      if (code !== 0 && retryCount < MAX_SSH_RETRIES) {
        console.log(`[HF Status] SSH command failed (exit ${code}), retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        const retryResult = await executeRemoteCommand(host, port, username, password, command, timeoutMs, retryCount + 1);
        resolve(retryResult);
        return;
      }

      resolve({
        success: code === 0,
        output: stdout + stderr,
      });
    });

    proc.on("error", async (err) => {
      // Retry on connection errors
      if (retryCount < MAX_SSH_RETRIES) {
        console.log(`[HF Status] SSH error: ${err.message}, retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        const retryResult = await executeRemoteCommand(host, port, username, password, command, timeoutMs, retryCount + 1);
        resolve(retryResult);
        return;
      }

      resolve({
        success: false,
        output: `Failed: ${err.message}`,
      });
    });
  });
}

/**
 * Parse SSH command to extract connection details
 */
function parseSSHCommand(cmd: string): { host: string; port: number; username: string } {
  const userHostMatch = cmd.match(/(\w+)@([^\s]+)/);
  const username = userHostMatch ? userHostMatch[1] : "ubuntu";
  const host = userHostMatch ? userHostMatch[2] : "localhost";

  const portMatch = cmd.match(/-p\s+(\d+)/);
  const port = portMatch ? parseInt(portMatch[1], 10) : 22;

  return { host, port, username };
}

export type DeploymentStatus =
  | "not_started"
  | "installing"
  | "downloading"
  | "install_complete"
  | "starting"
  | "running"
  | "failed";

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
  advanced?: AdvancedStatus;
}

/**
 * GET /api/huggingface/deploy-status
 *
 * Query params:
 * - subscriptionId: GPU subscription ID
 *
 * Returns deployment status by checking install.log and vLLM server status
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, customer, teamId } = auth;

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get("subscriptionId");

    if (!subscriptionId) {
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

    // Verify the subscription belongs to this team
    const subscriptions = await getPoolSubscriptions(teamId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = subscriptions.find((s: any) => String(s.id) === subscriptionId);

    if (!sub) {
      console.log(`[HF Status] Subscription ${subscriptionId} not found for team ${teamId}`);
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // Get connection info
    const connInfo = await getConnectionInfo(teamId, subscriptionId);

    if (!connInfo || connInfo.length === 0) {
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: "GPU is being provisioned. This usually takes 30-60 seconds.",
      });
    }

    const subscription = connInfo.find(
      (s) => String(s.id) === String(subscriptionId)
    );

    if (!subscription || !subscription.pods || subscription.pods.length === 0) {
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: "Waiting for GPU pod to be scheduled...",
      });
    }

    const pod = subscription.pods[0];
    const podStatusLower = pod.pod_status?.toLowerCase() || "";

    // Pod has terminated - "Succeeded" means it exited cleanly, "Failed" means it crashed
    if (["succeeded", "failed", "terminated", "error", "crashloopbackoff"].includes(podStatusLower)) {
      console.log(`[HF Status] Pod ${pod.pod_name} terminated with status: ${pod.pod_status}`);

      // Update deployment record
      const deployment = await prisma.huggingFaceDeployment.findFirst({
        where: { subscriptionId },
        orderBy: { createdAt: "desc" },
      });

      if (deployment && deployment.status !== "failed") {
        await prisma.huggingFaceDeployment.update({
          where: { id: deployment.id },
          data: {
            status: "failed",
            errorMessage: `Pod terminated unexpectedly (${pod.pod_status}). Please terminate this GPU and launch a new one.`,
          },
        });

        await logActivity(
          payload.customerId,
          "hf_deployment_pod_terminated",
          `HuggingFace deployment pod terminated: ${deployment.hfItemName}`,
          {
            deploymentId: deployment.id,
            podStatus: pod.pod_status,
          }
        );
      }

      return NextResponse.json<StatusResponse>({
        status: "failed",
        message: `Pod terminated unexpectedly (${pod.pod_status}). Please terminate this GPU and launch a new one.`,
        error: "POD_TERMINATED",
      });
    }

    // Pod is not running yet
    if (podStatusLower !== "running") {
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: `Pod status: ${pod.pod_status}. Waiting for it to start...`,
      });
    }

    // Check SSH info availability
    if (!pod.ssh_info || !pod.ssh_info.cmd || !pod.ssh_info.pass) {
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: "Pod is running, waiting for SSH access...",
      });
    }

    // Parse SSH command
    const sshDetails = parseSSHCommand(pod.ssh_info.cmd);
    const { host, port, username } = sshDetails;

    // Check status by examining install.log and server status
    // Also gather GPU info and model loading progress for advanced view
    const statusCommand = `
      WORKSPACE="$HOME/hf-workspace"

      # Check if install.log exists (indicates script has run)
      if [ ! -f "$WORKSPACE/install.log" ]; then
        echo "STATUS:not_started"
        echo "PROGRESS:0"
        exit 0
      fi

      # Check install status
      INSTALL_DONE=false
      if grep -q "INSTALL_COMPLETE" "$WORKSPACE/install.log" 2>/dev/null; then
        INSTALL_DONE=true
      fi

      # Check if model is downloading (HuggingFace download messages)
      DOWNLOADING=false
      if grep -E -q "Downloading|Fetching.*files|download.*model" "$WORKSPACE/install.log" 2>/dev/null; then
        if ! grep -q "INSTALL_COMPLETE" "$WORKSPACE/install.log" 2>/dev/null; then
          DOWNLOADING=true
        fi
      fi

      # Check if vLLM server process is running
      SERVER_RUNNING=false
      if pgrep -f "vllm.entrypoints" > /dev/null 2>&1; then
        SERVER_RUNNING=true
      fi

      # Check if server is responding (healthy)
      SERVER_HEALTHY=false
      if curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health 2>/dev/null | grep -q "200"; then
        SERVER_HEALTHY=true
      elif curl -s http://localhost:8000/v1/models 2>/dev/null | grep -q "data"; then
        SERVER_HEALTHY=true
      fi

      # Check for errors in vllm.log
      HAS_NVSHARE_ERROR=false
      HAS_CUDA_OOM=false
      HAS_GPU_MEMORY_LOW=false
      HAS_ENGINE_INIT_FAILED=false
      HAS_MODEL_NOT_FOUND=false
      HAS_AUTH_ERROR=false

      if [ -f "$WORKSPACE/vllm.log" ]; then
        # GPU scheduler errors
        if grep -E -q "nvshare_connect|haishare|scheduler.sock|No such file or directory.*haishare" "$WORKSPACE/vllm.log" 2>/dev/null; then
          HAS_NVSHARE_ERROR=true
        fi
        # CUDA out of memory
        if grep -E -q "CUDA out of memory|OutOfMemoryError|torch.OutOfMemoryError|torch.cuda.OutOfMemoryError" "$WORKSPACE/vllm.log" 2>/dev/null; then
          HAS_CUDA_OOM=true
        fi
        # Low GPU memory warning
        if grep -q "Free memory on device.*less than desired" "$WORKSPACE/vllm.log" 2>/dev/null; then
          HAS_GPU_MEMORY_LOW=true
        fi
        # Engine initialization failure
        if grep -E -q "Engine core initialization failed|Failed core proc|EngineCore failed to start|Failed to initialize engine" "$WORKSPACE/vllm.log" 2>/dev/null; then
          HAS_ENGINE_INIT_FAILED=true
        fi
        # Model not found
        if grep -E -q "Model.*not found|repository.*not found|Could not find model" "$WORKSPACE/vllm.log" 2>/dev/null; then
          HAS_MODEL_NOT_FOUND=true
        fi
        # Authentication error
        if grep -E -q "401 Client Error|Access denied|Unauthorized|gated repo" "$WORKSPACE/vllm.log" 2>/dev/null; then
          HAS_AUTH_ERROR=true
        fi
      fi

      # Determine status and progress - healthy server takes priority
      if [ "$SERVER_HEALTHY" = true ]; then
        echo "STATUS:running"
        echo "PROGRESS:100"
      elif [ "$HAS_AUTH_ERROR" = true ]; then
        echo "STATUS:failed"
        echo "PROGRESS:0"
        echo "ERROR:AUTH_ERROR"
      elif [ "$HAS_MODEL_NOT_FOUND" = true ]; then
        echo "STATUS:failed"
        echo "PROGRESS:0"
        echo "ERROR:MODEL_NOT_FOUND"
      elif [ "$HAS_NVSHARE_ERROR" = true ]; then
        echo "STATUS:failed"
        echo "PROGRESS:0"
        echo "ERROR:GPU_SCHEDULER_ERROR"
      elif [ "$HAS_CUDA_OOM" = true ]; then
        echo "STATUS:failed"
        echo "PROGRESS:0"
        echo "ERROR:CUDA_OOM"
      elif [ "$HAS_ENGINE_INIT_FAILED" = true ]; then
        echo "STATUS:failed"
        echo "PROGRESS:0"
        echo "ERROR:ENGINE_INIT_FAILED"
      elif [ "$HAS_GPU_MEMORY_LOW" = true ]; then
        echo "STATUS:failed"
        echo "PROGRESS:0"
        echo "ERROR:GPU_MEMORY_LOW"
      elif [ "$SERVER_RUNNING" = true ]; then
        echo "STATUS:starting"
        echo "PROGRESS:80"
      elif [ "$DOWNLOADING" = true ]; then
        echo "STATUS:downloading"
        echo "PROGRESS:50"
      elif [ "$INSTALL_DONE" = true ]; then
        echo "STATUS:install_complete"
        echo "PROGRESS:70"
      else
        echo "STATUS:installing"
        echo "PROGRESS:20"
      fi

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
        # Look for model loading indicators
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
      host,
      port,
      username,
      pod.ssh_info.pass,
      statusCommand
    );

    if (!result.success) {
      console.log(`[HF Status] SSH command failed for ${pod.pod_name}: ${result.output.slice(-200)}`);
      return NextResponse.json<StatusResponse>({
        status: "not_started",
        message: "Connecting to GPU... (SSH may still be starting)",
        error: result.output.slice(-500),
      });
    }

    // Parse output
    const statusMatch = result.output.match(/STATUS:(\w+)/);
    const status = (statusMatch?.[1] || "not_started") as DeploymentStatus;

    const progressMatch = result.output.match(/PROGRESS:(\d+)/);
    const progressPercent = progressMatch ? parseInt(progressMatch[1], 10) : undefined;

    const errorMatch = result.output.match(/ERROR:(\w+)/);
    const errorType = errorMatch?.[1];

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

    // Specific error messages for known issues
    const errorMessages: Record<string, string> = {
      GPU_SCHEDULER_ERROR: "GPU scheduler service unavailable. This is a temporary infrastructure issue. Please terminate this GPU and launch a new one.",
      ENGINE_INIT_FAILED: "Failed to initialize GPU. The model could not start on this GPU. Try terminating and launching a new GPU.",
      CUDA_OOM: "Not enough GPU memory for this model. Try a smaller model or a GPU with more VRAM.",
      GPU_MEMORY_LOW: "Insufficient GPU memory available. The model is too large for this GPU. Try a smaller model or a GPU with more VRAM.",
      POD_TERMINATED: "The GPU pod terminated unexpectedly. Please terminate this deployment and try again.",
      MODEL_NOT_FOUND: "Model not found on HuggingFace. Please check the model ID is correct.",
      AUTH_ERROR: "Authentication failed. This model may require a HuggingFace token. Please add your token and try again.",
    };

    let message = statusMessages[status] || "Unknown status";
    if (status === "failed" && errorType && errorMessages[errorType]) {
      message = errorMessages[errorType];
    }

    // Get deployment record for additional info
    const deployment = await prisma.huggingFaceDeployment.findFirst({
      where: { subscriptionId },
      orderBy: { createdAt: "desc" },
    });

    // Calculate elapsed time
    const elapsedSeconds = deployment
      ? Math.floor((Date.now() - deployment.createdAt.getTime()) / 1000)
      : undefined;

    // Build response with simple and advanced views
    const response: StatusResponse = {
      // Simple view - always included
      status,
      message,
      progressPercent,
      error: errorType, // Include error code at top level for easy access

      // Advanced view - for power users
      advanced: {
        logs: logs.slice(-3000), // Last 3000 chars of logs
        sshCommand: `ssh ${username}@${host} -p ${port}`,
        podName: pod.pod_name,
        podStatus: pod.pod_status,
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

    if (status === "running") {
      response.advanced!.apiEndpoint = `http://localhost:8000/v1`;
    }

    // Update database and send email if status has changed to final state
    if ((status === "running" || status === "failed") && deployment) {
      try {
        if (deployment.status !== status) {
          const previousStatus = deployment.status;
          console.log(`[HF Status] Updating deployment ${deployment.id}: ${previousStatus} -> ${status}`);

          // Update the deployment record
          await prisma.huggingFaceDeployment.update({
            where: { id: deployment.id },
            data: {
              status: status === "running" ? "running" : "failed",
              errorMessage: status === "failed" ? message : null,
            },
          });

          // Log activity
          await logActivity(
            payload.customerId,
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
              const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
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
