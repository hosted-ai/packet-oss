/**
 * GPU Apps Install API - Install an app on a pod via SSH
 *
 * POST /api/apps/install
 * Body: { subscriptionId: string, appSlug: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { GPU_APPS, getAppBySlug } from "@/lib/gpu-apps";
import { prisma } from "@/lib/prisma";
import { verifyCustomerToken } from "@/lib/auth";
import { getConnectionInfo } from "@/lib/hostedai";
import { getStripe } from "@/lib/stripe";
import Stripe from "stripe";
import { spawn } from "child_process";
import { getOrCreateServerSSHKey, executeSSHWithKey } from "@/lib/ssh-keys";
import { validateSSHParams } from "@/lib/ssh-validation";

/**
 * Execute SSH command on a pod using password auth (for key injection)
 */
async function executeSSHCommandWithPassword(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs: number = 60000 // 1 minute default for key injection
): Promise<{ success: boolean; output: string; exitCode: number }> {
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
          output: stdout + (stderr ? `\n${stderr}` : ""),
          exitCode: code || 0,
        });
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        resolve({
          success: false,
          output: `Error: ${err.message}`,
          exitCode: -1,
        });
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({
          success: false,
          output: "Command timed out after " + (timeoutMs / 1000) + " seconds",
          exitCode: -2,
        });
      }
    }, timeoutMs);
  });
}

/**
 * Inject server SSH public key into pod's authorized_keys
 */
async function injectSSHKey(
  host: string,
  port: number,
  username: string,
  password: string,
  publicKey: string
): Promise<{ success: boolean; error?: string }> {
  // Command to add key to authorized_keys if not already present
  const keyContent = publicKey.trim();
  const command = `
    mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
    touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \
    if ! grep -qF "${keyContent}" ~/.ssh/authorized_keys 2>/dev/null; then \
      echo "${keyContent}" >> ~/.ssh/authorized_keys && echo "KEY_ADDED"; \
    else \
      echo "KEY_EXISTS"; \
    fi
  `.trim();

  const result = await executeSSHCommandWithPassword(host, port, username, password, command);

  if (!result.success) {
    return { success: false, error: `Failed to inject SSH key: ${result.output}` };
  }

  return { success: true };
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
    username: userMatch ? userMatch[1] : "ubuntu",
  };
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyCustomerToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = await request.json();
  const { subscriptionId, appSlug } = body;

  if (!subscriptionId || !appSlug) {
    return NextResponse.json(
      { error: "subscriptionId and appSlug are required" },
      { status: 400 }
    );
  }

  // Get app definition
  const app = getAppBySlug(appSlug);
  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  // Get teamId from Stripe customer metadata first
  const stripe = getStripe();
  const customerResult = await stripe.customers.retrieve(payload.customerId);
  if ("deleted" in customerResult && customerResult.deleted) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  const customer = customerResult as Stripe.Customer;
  const teamId = customer.metadata?.hostedai_team_id;

  if (!teamId) {
    return NextResponse.json(
      { error: "No team associated with this account" },
      { status: 400 }
    );
  }

  // Verify user owns this subscription via hosted.ai API
  const connectionInfo = await getConnectionInfo(teamId, subscriptionId);
  if (!connectionInfo || connectionInfo.length === 0) {
    return NextResponse.json(
      { error: "Subscription not found or not owned by you" },
      { status: 404 }
    );
  }

  const conn = connectionInfo[0];
  const pod = conn?.pods?.[0];

  if (!pod?.ssh_info?.cmd || !pod?.ssh_info?.pass) {
    return NextResponse.json(
      { error: "Could not get SSH connection info - pod may not be running" },
      { status: 500 }
    );
  }

  // Check if app is already installed
  const existingInstall = await prisma.installedApp.findFirst({
    where: {
      subscriptionId,
      app: { slug: appSlug },
      status: { notIn: ["uninstalled", "failed"] },
    },
  });

  if (existingInstall) {
    return NextResponse.json(
      { error: "App is already installed or installing", status: existingInstall.status },
      { status: 400 }
    );
  }

  // Get or create the app in database
  let dbApp = await prisma.gpuApp.findUnique({ where: { slug: appSlug } });
  if (!dbApp) {
    dbApp = await prisma.gpuApp.create({
      data: {
        slug: app.slug,
        name: app.name,
        description: app.description,
        longDescription: app.longDescription,
        category: app.category,
        installScript: app.slug, // Reference to the script
        estimatedInstallMin: app.estimatedInstallMin,
        minVramGb: app.minVramGb,
        recommendedVramGb: app.recommendedVramGb,
        typicalVramUsageGb: app.typicalVramUsageGb,
        defaultPort: app.defaultPort,
        webUiPort: app.webUiPort,
        serviceType: app.serviceType,
        icon: app.icon,
        badgeText: app.badgeText,
        displayOrder: app.displayOrder,
        tags: JSON.stringify(app.tags),
        docsUrl: app.docsUrl,
      },
    });
  }

  // Create installation record
  const installation = await prisma.installedApp.create({
    data: {
      subscriptionId,
      stripeCustomerId: payload.customerId,
      appId: dbApp.id,
      status: "installing",
      installProgress: 0,
    },
  });

  // Parse SSH connection info (we already have conn and pod from earlier validation)
  const { host, port, username } = parseSSHInfo(pod.ssh_info.cmd);
  const password = pod.ssh_info.pass;

  // Start installation in background
  (async () => {
    try {
      // Update progress
      await prisma.installedApp.update({
        where: { id: installation.id },
        data: { installProgress: 5, installOutput: "Getting server SSH key..." },
      });

      // Step 1: Get or create server SSH key
      const { publicKey, privateKeyPath } = await getOrCreateServerSSHKey();

      await prisma.installedApp.update({
        where: { id: installation.id },
        data: { installProgress: 10, installOutput: "Injecting SSH key into pod..." },
      });

      // Step 2: Inject the public key into the pod using password auth (one-time)
      const keyInjection = await injectSSHKey(host, port, username, password, publicKey);
      if (!keyInjection.success) {
        // Fall back to password-based install if key injection fails
        console.warn(`Key injection failed, falling back to password auth: ${keyInjection.error}`);
        await prisma.installedApp.update({
          where: { id: installation.id },
          data: { installProgress: 15, installOutput: "Connecting to pod (fallback mode)..." },
        });

        // Use password-based SSH for install
        const result = await executeSSHCommandWithPassword(
          host,
          port,
          username,
          password,
          app.installScript,
          app.estimatedInstallMin * 60 * 1000 * 2
        );

        if (result.success) {
          const portMatch = result.output.match(/PORT=(\d+)/);
          const installedPort = portMatch ? parseInt(portMatch[1], 10) : app.defaultPort;

          await prisma.installedApp.update({
            where: { id: installation.id },
            data: {
              status: "running",
              installProgress: 100,
              installOutput: result.output,
              port: installedPort,
              webUiPort: app.webUiPort,
              startedAt: new Date(),
            },
          });
        } else {
          await prisma.installedApp.update({
            where: { id: installation.id },
            data: {
              status: "failed",
              installProgress: 0,
              installOutput: result.output,
              errorMessage: `Installation failed with exit code ${result.exitCode}`,
            },
          });
        }
        return;
      }

      await prisma.installedApp.update({
        where: { id: installation.id },
        data: { installProgress: 20, installOutput: "Running install script..." },
      });

      // Step 3: Execute install script using key-based SSH (more reliable for long-running commands)
      const result = await executeSSHWithKey(
        host,
        port,
        username,
        privateKeyPath,
        app.installScript,
        app.estimatedInstallMin * 60 * 1000 * 2 // Double the estimate for safety
      );

      if (result.success) {
        // Parse output for port info
        const portMatch = result.output.match(/PORT=(\d+)/);
        const installedPort = portMatch ? parseInt(portMatch[1], 10) : app.defaultPort;

        await prisma.installedApp.update({
          where: { id: installation.id },
          data: {
            status: "running",
            installProgress: 100,
            installOutput: result.output,
            port: installedPort,
            webUiPort: app.webUiPort,
            startedAt: new Date(),
          },
        });
      } else {
        await prisma.installedApp.update({
          where: { id: installation.id },
          data: {
            status: "failed",
            installProgress: 0,
            installOutput: result.output,
            errorMessage: `Installation failed with exit code ${result.exitCode}`,
          },
        });
      }
    } catch (error) {
      await prisma.installedApp.update({
        where: { id: installation.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  })();

  return NextResponse.json({
    success: true,
    installationId: installation.id,
    message: `Installing ${app.name}... This may take ${app.estimatedInstallMin} minutes.`,
  });
}
