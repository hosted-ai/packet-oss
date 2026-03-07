import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getConnectionInfo } from "@/lib/hostedai";
import { getSSHKey } from "@/lib/ssh-keys";
import { spawn } from "child_process";
import Stripe from "stripe";
import { validateSSHParams } from "@/lib/ssh-validation";

// Parse SSH command to extract host and port
// Format: "ssh root@hostname -p port" or "ssh root@hostname"
function parseSSHCommand(cmd: string): { host: string; port: number; username: string } {
  const parts = cmd.trim().split(/\s+/);

  // Find user@host part
  const userHostPart = parts.find(p => p.includes("@"));
  if (!userHostPart) {
    throw new Error("Invalid SSH command format - missing user@host");
  }

  const [username, host] = userHostPart.split("@");

  // Find port (-p flag)
  let port = 22;
  const portFlagIndex = parts.indexOf("-p");
  if (portFlagIndex !== -1 && parts[portFlagIndex + 1]) {
    port = parseInt(parts[portFlagIndex + 1], 10);
  }

  return { host, port, username };
}

// Sanitize SSH public key to prevent command injection
// Only keeps the key type, base64 data, and alphanumeric comment
function sanitizeSSHKey(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error("Invalid SSH key format");
  }

  const keyType = parts[0];
  const keyData = parts[1];

  // Validate key type contains only allowed characters
  if (!/^[a-z0-9-]+$/i.test(keyType)) {
    throw new Error("Invalid SSH key type");
  }

  // Validate base64 data contains only base64 characters
  if (!/^[A-Za-z0-9+/=]+$/.test(keyData)) {
    throw new Error("Invalid SSH key data");
  }

  // Sanitize comment: only allow alphanumeric, @, ., -, _
  // This prevents shell injection via malicious comments
  let comment = "";
  if (parts.length > 2) {
    comment = parts.slice(2).join(" ").replace(/[^a-zA-Z0-9@._\-\s]/g, "");
    if (comment.length > 100) {
      comment = comment.substring(0, 100);
    }
  }

  return comment ? `${keyType} ${keyData} ${comment}` : `${keyType} ${keyData}`;
}

// Inject SSH public key into VM's authorized_keys using sshpass
async function injectSSHKey(
  host: string,
  port: number,
  username: string,
  password: string,
  publicKey: string
): Promise<{ success: boolean; output: string }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve, reject) => {
    // Sanitize the key to prevent command injection
    const sanitizedKey = sanitizeSSHKey(publicKey);

    // Base64 encode the key to avoid any shell interpretation issues
    const encodedKey = Buffer.from(sanitizedKey).toString("base64");

    // Build the command using base64 decoding to safely handle the key
    // This completely avoids shell interpretation of the key content
    const remoteCommand = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && KEY=$(echo '${encodedKey}' | base64 -d) && if ! grep -qF "$KEY" ~/.ssh/authorized_keys 2>/dev/null; then echo "$KEY" >> ~/.ssh/authorized_keys && echo "Key added successfully"; else echo "Key already exists"; fi`;

    // Use sshpass with SSHPASS env var (-e) to safely handle special characters in password
    const args = [
      "-e",  // Use SSHPASS environment variable
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "ConnectTimeout=20",
      "-p", String(port),
      `${username}@${host}`,
      remoteCommand
    ];

    console.log(`Injecting SSH key into ${username}@${host}:${port}`);

    const proc = spawn("sshpass", args, {
      timeout: 30000,
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
      console.log("SSH key injection result - code:", code, "stdout:", stdout.trim(), "stderr:", stderr.trim());

      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        // Check for common errors
        if (stderr.includes("Permission denied")) {
          reject(new Error("Authentication failed - password may be incorrect"));
        } else if (stderr.includes("Connection refused") || stderr.includes("No route to host")) {
          reject(new Error("Could not connect to VM - it may be starting up or unavailable"));
        } else if (stderr.includes("Connection timed out")) {
          reject(new Error("Connection timed out - VM may be unavailable"));
        } else {
          reject(new Error(stderr || `SSH command failed with code ${code}`));
        }
      }
    });

    proc.on("error", (err) => {
      // sshpass not installed - fall back to instructions
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("sshpass not available on server - please contact support"));
      } else {
        reject(err);
      }
    });
  });
}

// POST - Inject SSH key into a running VM
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

    const { keyId, publicKey, subscriptionId, podName } = await request.json();

    if (!keyId && !publicKey) {
      return NextResponse.json(
        { error: "SSH key ID or public key is required" },
        { status: 400 }
      );
    }

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "Subscription ID is required" },
        { status: 400 }
      );
    }

    // Get the SSH key - either from database or use the provided public key directly
    let keyToInject: string;
    let keyName: string;

    if (keyId) {
      // Get the SSH key from database
      const sshKey = await getSSHKey(keyId, payload.customerId);
      if (!sshKey) {
        return NextResponse.json(
          { error: "SSH key not found" },
          { status: 404 }
        );
      }
      keyToInject = sshKey.publicKey;
      keyName = sshKey.name;
    } else {
      // Use the provided public key directly
      keyToInject = publicKey;
      keyName = "Direct key";
    }

    // Get customer to find team ID
    const stripe = getStripe();
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

    // Find the target pod (by name or use first one)
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

    console.log(
      `Injecting SSH key "${keyName}" into ${host}:${port} for user ${username}`
    );

    // Inject the SSH key
    const result = await injectSSHKey(host, port, username, pass, keyToInject);

    return NextResponse.json({
      success: true,
      message: result.output.includes("already exists")
        ? `SSH key "${keyName}" is already installed on the VM`
        : `SSH key "${keyName}" has been added to the VM`,
      pod: targetPod.pod_name,
    });
  } catch (error) {
    console.error("Inject SSH key error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to inject SSH key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
