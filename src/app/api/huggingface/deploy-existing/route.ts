import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getConnectionInfo, getPoolSubscriptions } from "@/lib/hostedai";
import {
  generateDeployScript,
  getDefaultPort,
} from "@/lib/huggingface-deploy-scripts";
import { getCatalogItem, DeployScriptType } from "@/lib/huggingface-catalog";
import { logActivity } from "@/lib/activity";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";
import { validateSSHParams } from "@/lib/ssh-validation";

/**
 * Execute a script on a remote pod via SSH
 */
async function executeRemoteScript(
  host: string,
  port: number,
  username: string,
  password: string,
  script: string,
  timeoutMs: number = 300000 // 5 minutes for model deployment
): Promise<{ success: boolean; output: string; exitCode: number }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
    const encodedScript = Buffer.from(script).toString("base64");
    const remoteCommand = `echo '${encodedScript}' | base64 -d | bash`;

    // Use sshpass with SSHPASS env var (-e) to safely handle special characters in password
    const args = [
      "-e",  // Use SSHPASS environment variable
      "ssh",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=20",
      "-p",
      String(port),
      `${username}@${host}`,
      remoteCommand,
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
        exitCode: code || 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        output: `Failed to execute: ${err.message}`,
        exitCode: -1,
      });
    });
  });
}

/**
 * Parse SSH host from command like "ssh root@192.168.1.1 -p 22"
 */
function parseSSHHost(cmd: string): string {
  const match = cmd.match(/@([^\s]+)/);
  return match ? match[1] : "localhost";
}

/**
 * Parse SSH port from command
 */
function parseSSHPort(cmd: string): number {
  const match = cmd.match(/-p\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 22;
}

/**
 * POST /api/huggingface/deploy-existing
 *
 * Deploy a HuggingFace model to an existing GPU subscription
 *
 * Body:
 * - hfItemId: Catalog item ID or HF Hub ID
 * - subscriptionId: Existing subscription ID
 * - hfToken: Optional HF token for gated models
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { hfItemId, subscriptionId, hfToken, openWebUI, netdata } = body;

    if (!hfItemId) {
      return NextResponse.json(
        { error: "hfItemId is required" },
        { status: 400 }
      );
    }

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "subscriptionId is required" },
        { status: 400 }
      );
    }

    // Get catalog item (or construct one for HF Hub items)
    const catalogItem = getCatalogItem(hfItemId);
    let deployScript: DeployScriptType = "tgi";

    if (catalogItem) {
      deployScript = catalogItem.deployScript;
    } else {
      deployScript = body.deployScript || "tgi";
    }

    // Validate HF token if needed
    if (catalogItem?.gated && !hfToken) {
      return NextResponse.json(
        {
          error: "This model requires a HuggingFace token",
          requiresToken: true,
          tokenUrl: "https://huggingface.co/settings/tokens",
        },
        { status: 400 }
      );
    }

    if (hfToken && !hfToken.startsWith("hf_")) {
      return NextResponse.json(
        { error: "Invalid HuggingFace token format. Token should start with 'hf_'" },
        { status: 400 }
      );
    }

    // Verify the subscription belongs to this team
    const subscriptions = await getPoolSubscriptions(teamId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = subscriptions.find((s: any) => String(s.id) === String(subscriptionId));

    if (!sub) {
      return NextResponse.json(
        { error: "Subscription not found or doesn't belong to your account" },
        { status: 404 }
      );
    }

    // Get connection info for the subscription
    console.log(`[HF Deploy] Getting connection info for team ${teamId}, subscription ${subscriptionId}`);
    const connInfo = await getConnectionInfo(teamId, subscriptionId);
    console.log(`[HF Deploy] Connection info response:`, JSON.stringify(connInfo, null, 2));

    if (!connInfo || connInfo.length === 0) {
      return NextResponse.json(
        { error: "No connection info available for this subscription." },
        { status: 400 }
      );
    }

    // Find the subscription by ID (similar to run-script route)
    const subscription = connInfo.find(
      (s) => String(s.id) === String(subscriptionId)
    );

    if (!subscription || !subscription.pods || subscription.pods.length === 0) {
      return NextResponse.json(
        { error: "No running pods found for this subscription. The GPU may still be starting." },
        { status: 400 }
      );
    }

    const pod = subscription.pods[0];
    if (!pod.ssh_info || !pod.ssh_info.cmd || !pod.ssh_info.pass) {
      return NextResponse.json(
        { error: "SSH credentials not available for this pod" },
        { status: 400 }
      );
    }

    if (pod.pod_status?.toLowerCase() !== "running") {
      return NextResponse.json(
        { error: `Pod is not running (status: ${pod.pod_status}). Please wait for it to start.` },
        { status: 400 }
      );
    }

    // Parse SSH command to get host, port, and username
    const sshCmd = pod.ssh_info.cmd;
    const parts = sshCmd.trim().split(/\s+/);
    const userHostPart = parts.find((p: string) => p.includes("@"));

    let username = "root";
    let host = "localhost";
    if (userHostPart) {
      const [user, h] = userHostPart.split("@");
      username = user;
      host = h;
    }

    let port = 22;
    const portFlagIndex = parts.indexOf("-p");
    if (portFlagIndex !== -1 && parts[portFlagIndex + 1]) {
      port = parseInt(parts[portFlagIndex + 1], 10);
    }

    const connectionInfo = {
      host,
      port,
      username,
      password: pod.ssh_info.pass,
    };

    // Get GPU count from subscription for tensor parallelism
    const gpuCount = sub.per_pod_info?.vgpu_count || 1;

    // Generate and run deploy script
    console.log(`[HF Deploy] Running deploy script for ${hfItemId} on existing subscription ${subscriptionId} with ${gpuCount} GPUs`);
    console.log(`[HF Deploy] SSH: ${username}@${host}:${port} (cmd: ${sshCmd})`);

    const script = generateDeployScript(deployScript, {
      modelId: catalogItem?.type !== "docker" ? hfItemId : undefined,
      dockerImage: catalogItem?.dockerImage,
      port: getDefaultPort(deployScript),
      hfToken: hfToken || undefined,
      gpuCount,
      openWebUI: openWebUI || false,
      netdata: netdata || false,
    });

    const result = await executeRemoteScript(
      connectionInfo.host,
      connectionInfo.port,
      connectionInfo.username,
      connectionInfo.password,
      script
    );

    if (!result.success) {
      console.error(`[HF Deploy] Script failed:`, result.output);

      // Parse error output to provide better messages
      let errorMessage = "Deployment script failed.";
      const output = result.output;

      if (output.includes("Permission denied")) {
        errorMessage = "SSH authentication failed. The GPU credentials may have changed. Please try restarting the GPU.";
      } else if (output.includes("CUDA out of memory") || output.includes("OutOfMemoryError")) {
        errorMessage = "GPU ran out of VRAM. This model may need more VRAM. Try a smaller model or use quantization.";
      } else if (output.includes("No space left on device")) {
        errorMessage = "Not enough disk space. Try a GPU with more storage.";
      } else if (output.includes("docker") && output.includes("not found")) {
        errorMessage = "Docker installation failed. Please try again or contact support.";
      }

      return NextResponse.json(
        {
          error: errorMessage,
          logs: result.output,
          exitCode: result.exitCode,
        },
        { status: 500 }
      );
    }

    // Determine deployment status from script output
    const isInstalling = result.output.includes("DEPLOYMENT_INSTALLING");
    const isStarted = result.output.includes("DEPLOYMENT_STARTED");

    // Create or update HuggingFace deployment record in database
    // This is needed for the dashboard to track and display deployment progress
    const servicePort = getDefaultPort(deployScript);
    const modelName = catalogItem?.name || hfItemId.split("/").pop() || hfItemId;

    // Delete any existing deployment record for this subscription first
    await prisma.huggingFaceDeployment.deleteMany({
      where: { subscriptionId: String(subscriptionId) },
    });

    // Create new deployment record
    await prisma.huggingFaceDeployment.create({
      data: {
        subscriptionId: String(subscriptionId),
        stripeCustomerId: payload.customerId,
        hfItemId,
        hfItemType: catalogItem?.type || "model",
        hfItemName: modelName,
        deployScript,
        status: isInstalling ? "installing" : "starting",
        servicePort,
        openWebUI: openWebUI || false,
        webUiPort: openWebUI ? 3000 : null,
        netdata: netdata || false,
        netdataPort: netdata ? 19999 : null,
      },
    });

    console.log(`[HF Deploy] Created deployment record for ${modelName} on subscription ${subscriptionId}`);

    // Log activity
    await logActivity(
      payload.customerId,
      isInstalling ? "hf_deployment_installing" : "hf_deployment_running",
      `Deployed ${modelName} to existing GPU`,
      {
        subscriptionId,
        hfItemId,
        deployScript,
        isInstalling,
      }
    );

    console.log(`[HF Deploy] Success! Installing=${isInstalling} Started=${isStarted} Output:`, result.output.slice(-500));

    // Build message based on enabled features
    const features: string[] = ["vLLM"];
    if (openWebUI) features.push("Open WebUI");
    if (netdata) features.push("Netdata");
    const featuresStr = features.join(" and ");

    // Return appropriate message based on status
    if (isInstalling) {
      return NextResponse.json({
        success: true,
        installing: true,
        subscriptionId: String(subscriptionId),
        message: `${featuresStr} ${features.length > 1 ? 'are' : 'is'} being installed in the background. This takes 5-10 minutes. The servers will start automatically when done.`,
        instructions: "Check progress with: tail -f ~/hf-workspace/install.log",
        servicePort,
        webUiPort: openWebUI ? 3000 : null,
        netdataPort: netdata ? 19999 : null,
        serviceHost: connectionInfo.host,
        logs: result.output,
      });
    }

    return NextResponse.json({
      success: true,
      subscriptionId: String(subscriptionId),
      message: `Deployment complete! ${featuresStr} ${features.length > 1 ? 'are' : 'is'} starting up.`,
      servicePort,
      webUiPort: openWebUI ? 3000 : null,
      netdataPort: netdata ? 19999 : null,
      serviceHost: connectionInfo.host,
      logs: result.output,
    });
  } catch (error) {
    console.error("Deploy to existing error:", error);
    return NextResponse.json(
      { error: "Failed to deploy to existing GPU" },
      { status: 500 }
    );
  }
}
