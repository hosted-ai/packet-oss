import { PrismaClient, SSHKey } from "@prisma/client";
import crypto from "crypto";
import { validateSSHParams } from "./ssh-validation";

// Lazy initialization to avoid build-time connection issues
let prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Calculate SSH key fingerprint (MD5 format like ssh-keygen -l)
export function calculateFingerprint(publicKey: string): string {
  // Extract the key data from the public key string
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error("Invalid SSH public key format");
  }

  const keyData = parts[1];
  const buffer = Buffer.from(keyData, "base64");
  const hash = crypto.createHash("md5").update(buffer).digest("hex");

  // Format as colon-separated pairs
  return hash.match(/.{2}/g)?.join(":") || hash;
}

// Validate SSH public key format
export function validatePublicKey(publicKey: string): {
  valid: boolean;
  error?: string;
  type?: string;
} {
  const trimmed = publicKey.trim();

  // Check if it starts with a valid key type
  const validTypes = [
    "ssh-rsa",
    "ssh-ed25519",
    "ssh-dss",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
  ];

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return { valid: false, error: "Invalid SSH public key format" };
  }

  const keyType = parts[0];
  if (!validTypes.includes(keyType)) {
    return { valid: false, error: `Unsupported key type: ${keyType}` };
  }

  // Try to decode the base64 key data
  try {
    const keyData = parts[1];
    Buffer.from(keyData, "base64");
  } catch {
    return { valid: false, error: "Invalid base64 encoding in key" };
  }

  return { valid: true, type: keyType };
}

// Get all SSH keys for a customer
export async function getSSHKeys(stripeCustomerId: string): Promise<SSHKey[]> {
  const db = getPrisma();
  return db.sSHKey.findMany({
    where: { stripeCustomerId },
    orderBy: { createdAt: "desc" },
  });
}

// Add a new SSH key
export async function addSSHKey(params: {
  stripeCustomerId: string;
  name: string;
  publicKey: string;
}): Promise<SSHKey> {
  const { stripeCustomerId, name, publicKey } = params;

  // Validate the key
  const validation = validatePublicKey(publicKey);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Calculate fingerprint
  const fingerprint = calculateFingerprint(publicKey);

  const db = getPrisma();

  // Check if this key already exists for this customer
  const existing = await db.sSHKey.findFirst({
    where: { stripeCustomerId, fingerprint },
  });
  if (existing) {
    throw new Error(`This SSH key is already added as "${existing.name}"`);
  }

  return db.sSHKey.create({
    data: {
      stripeCustomerId,
      name: name.trim(),
      publicKey: publicKey.trim(),
      fingerprint,
    },
  });
}

// Delete an SSH key
export async function deleteSSHKey(
  keyId: string,
  stripeCustomerId: string
): Promise<void> {
  const db = getPrisma();
  await db.sSHKey.delete({
    where: {
      id: keyId,
      stripeCustomerId, // Ensure ownership
    },
  });
}

// Get a single SSH key by ID
export async function getSSHKey(
  keyId: string,
  stripeCustomerId: string
): Promise<SSHKey | null> {
  const db = getPrisma();
  return db.sSHKey.findFirst({
    where: {
      id: keyId,
      stripeCustomerId,
    },
  });
}

// Server-side SSH key management for app installations
// The key is stored in the database with a special "server" customer ID
const SERVER_KEY_CUSTOMER_ID = "__SERVER__";
const SERVER_KEY_NAME = "packet-apps-server";

import { generateKeyPairSync } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Get or generate the server-side SSH key pair for app installations
export async function getOrCreateServerSSHKey(): Promise<{
  publicKey: string;
  privateKeyPath: string;
}> {
  const db = getPrisma();

  // Check if server key already exists in database
  let serverKey = await db.sSHKey.findFirst({
    where: {
      stripeCustomerId: SERVER_KEY_CUSTOMER_ID,
      name: SERVER_KEY_NAME,
    },
  });

  // Key file paths - use a consistent location
  const keyDir = path.join(os.tmpdir(), "packet-server-keys");
  const privateKeyPath = path.join(keyDir, "id_ed25519");
  const publicKeyPath = path.join(keyDir, "id_ed25519.pub");

  // Ensure key directory exists with proper permissions
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { mode: 0o700, recursive: true });
  }

  // If we have the key in DB but files are missing, recreate files
  if (serverKey) {
    // Check if private key file exists
    if (!fs.existsSync(privateKeyPath)) {
      // We need to regenerate since we can't recover private key from DB
      // (DB only stores public key)
      await db.sSHKey.delete({ where: { id: serverKey.id } });
      serverKey = null;
    } else {
      // Files exist, return them
      return {
        publicKey: serverKey.publicKey,
        privateKeyPath,
      };
    }
  }

  // Generate new ED25519 key pair
  console.log("Generating new server SSH key pair for app installations...");

  try {
    // Use ssh-keygen for proper OpenSSH format
    execSync(
      `ssh-keygen -t ed25519 -f "${privateKeyPath}" -N "" -C "${SERVER_KEY_NAME}@gpu-cloud"`,
      { stdio: "pipe" }
    );

    // Set proper permissions
    fs.chmodSync(privateKeyPath, 0o600);
    fs.chmodSync(publicKeyPath, 0o644);

    const publicKey = fs.readFileSync(publicKeyPath, "utf-8").trim();
    const fingerprint = calculateFingerprint(publicKey);

    // Store public key in database
    await db.sSHKey.create({
      data: {
        stripeCustomerId: SERVER_KEY_CUSTOMER_ID,
        name: SERVER_KEY_NAME,
        publicKey,
        fingerprint,
      },
    });

    console.log("Server SSH key generated successfully");

    return {
      publicKey,
      privateKeyPath,
    };
  } catch (error) {
    console.error("Failed to generate server SSH key:", error);
    throw new Error("Failed to generate server SSH key for app installations");
  }
}

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

// Inject the server's SSH key into a pod using SSH command and password
// This is the main entry point - takes the same format as connection info
export async function injectServerKeyUsingSSHInfo(
  sshCommand: string,
  password: string
): Promise<{ success: boolean; output: string }> {
  try {
    const { host, port, username } = parseSSHCommand(sshCommand);
    return injectServerKeyIntoPod(host, port, username, password);
  } catch (error) {
    console.error("[SSH] Error parsing SSH command:", error);
    return {
      success: false,
      output: error instanceof Error ? error.message : "Failed to parse SSH command",
    };
  }
}

// Inject the server's SSH key into a pod using password auth
// This ensures we can always access the pod even if password changes
export async function injectServerKeyIntoPod(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<{ success: boolean; output: string }> {
  const { spawn } = await import("child_process");

  try {
    // Validate SSH parameters to prevent command injection
    validateSSHParams({ host, port, username });

    // Get or create the server's SSH key pair
    const { publicKey } = await getOrCreateServerSSHKey();

    // Sanitize the key
    const parts = publicKey.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new Error("Invalid server SSH key format");
    }

    // Base64 encode the key for safe transport
    const encodedKey = Buffer.from(publicKey.trim()).toString("base64");

    // Build the command to inject the key
    const remoteCommand = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && KEY=$(echo '${encodedKey}' | base64 -d) && if ! grep -qF "$KEY" ~/.ssh/authorized_keys 2>/dev/null; then echo "$KEY" >> ~/.ssh/authorized_keys && echo "Server key added"; else echo "Server key exists"; fi`;

    return new Promise((resolve) => {
      const args = [
        "-e", // Use SSHPASS environment variable
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "ConnectTimeout=30",
        "-o", "LogLevel=ERROR",
        "-p", String(port),
        `${username}@${host}`,
        remoteCommand,
      ];

      const proc = spawn("sshpass", args, {
        timeout: 60000,
        env: { ...process.env, SSHPASS: password },
      });

      let stdout = "";
      let stderr = "";
      let resolved = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (!resolved) {
          resolved = true;
          if (code === 0) {
            console.log(`[SSH] Server key injected into ${host}:${port} - ${stdout.trim()}`);
            resolve({ success: true, output: stdout.trim() });
          } else {
            console.error(`[SSH] Failed to inject server key: ${stderr}`);
            resolve({ success: false, output: stderr || `Exit code ${code}` });
          }
        }
      });

      proc.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          console.error(`[SSH] Error injecting server key:`, err);
          resolve({ success: false, output: err.message });
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          resolve({ success: false, output: "Timed out" });
        }
      }, 60000);
    });
  } catch (error) {
    console.error("[SSH] Error in injectServerKeyIntoPod:", error);
    return {
      success: false,
      output: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Execute SSH command using the server's private key (no password needed)
export async function executeSSHWithKey(
  host: string,
  port: number,
  username: string,
  privateKeyPath: string,
  command: string,
  timeoutMs: number = 300000
): Promise<{ success: boolean; output: string; exitCode: number }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  const { spawn } = await import("child_process");

  return new Promise((resolve) => {
    const args = [
      "-i", privateKeyPath,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=30",
      "-o", "BatchMode=yes", // Fail immediately if key auth doesn't work
      "-p", String(port),
      `${username}@${host}`,
      command,
    ];

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const proc = spawn("ssh", args, {
      timeout: timeoutMs,
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
