import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getUnifiedInstances, getInstanceCredentials } from "@/lib/hostedai";
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

    // HAI 2.2: Verify instance belongs to this team
    const unifiedResult = await getUnifiedInstances(teamId);
    const instance = unifiedResult.items?.find(i => i.id === subscriptionId);

    if (!instance) {
      return NextResponse.json(
        { error: "Instance not found or doesn't belong to your account" },
        { status: 404 }
      );
    }

    if (instance.status?.toLowerCase() !== "running") {
      return NextResponse.json(
        { error: `Instance is not running (status: ${instance.status}). Please wait for it to start.` },
        { status: 400 }
      );
    }

    // Get SSH credentials via HAI 2.2 credentials API
    let connectionInfo: { host: string; port: number; username: string; password: string };
    try {
      const creds = await getInstanceCredentials(subscriptionId);
      if (!creds.ip || !creds.port || !creds.username || !creds.password) {
        return NextResponse.json(
          { error: "SSH credentials not available for this instance" },
          { status: 400 }
        );
      }
      connectionInfo = { host: creds.ip, port: creds.port, username: creds.username, password: creds.password };
    } catch {
      return NextResponse.json(
        { error: "Could not retrieve SSH credentials for this instance" },
        { status: 400 }
      );
    }

    const gpuCount = 1;

    // Generate and run deploy script
    console.log(`[HF Deploy] Running deploy script for ${hfItemId} on existing subscription ${subscriptionId} with ${gpuCount} GPUs`);
    console.log(`[HF Deploy] SSH: ${connectionInfo.username}@${connectionInfo.host}:${connectionInfo.port}`);

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
