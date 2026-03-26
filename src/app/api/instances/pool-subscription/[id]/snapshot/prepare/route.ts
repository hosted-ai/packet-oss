import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getPoolSubscriptions, getConnectionInfo, getAllPools, getStorageBlocks } from "@/lib/hostedai";
import { getStoragePricePerGBHourCents } from "@/lib/pricing";
import Stripe from "stripe";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";

// Maximum storage volumes per pod
const MAX_STORAGE_VOLUMES = 3;

// Parse SSH command to extract host, port, and username
function parseSSHCommand(cmd: string): { host: string; port: number; username: string } {
  const parts = cmd.trim().split(/\s+/);
  const userHostPart = parts.find(p => p.includes("@"));
  if (!userHostPart) {
    throw new Error("Invalid SSH command format");
  }
  const [username, host] = userHostPart.split("@");
  let port = 22;
  const portFlagIndex = parts.indexOf("-p");
  if (portFlagIndex !== -1 && parts[portFlagIndex + 1]) {
    port = parseInt(parts[portFlagIndex + 1], 10);
  }
  return { host, port, username };
}

// Execute a command on the remote VM via SSH
async function executeSSHCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs: number = 30000
): Promise<string> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve, reject) => {
    const args = [
      "-e",
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=10",
      "-p", String(port),
      `${username}@${host}`,
      command
    ];

    const proc = spawn("sshpass", args, {
      timeout: timeoutMs,
      env: { ...process.env, SSHPASS: password },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });

    proc.on("error", (err) => reject(err));

    setTimeout(() => {
      proc.kill();
      reject(new Error("Command timed out"));
    }, timeoutMs);
  });
}

// GET - Prepare snapshot creation (calculate data size, get storage options)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { id: subscriptionId } = await params;

    // Get customer to find team ID
    const stripe = await getStripe();
    const customer = (await stripe.customers.retrieve(payload.customerId)) as Stripe.Customer;
    const teamId = customer.metadata?.hostedai_team_id;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // Get subscription details
    const subscriptions = await getPoolSubscriptions(teamId);
    const subscription = subscriptions.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // Check existing persistent storage - can be in shared_volumes OR persistent_storage_gb
    const sharedVolumes = subscription.storage_details?.shared_volumes || [];
    const persistentStorageGb = subscription.storage_details?.persistent_storage_gb || 0;

    // User has storage if they have shared volumes OR persistent_storage_gb is set
    const hasExistingStorage = sharedVolumes.length > 0 || persistentStorageGb > 0;
    const existingVolumeCount = hasExistingStorage ? Math.max(sharedVolumes.length, 1) : 0;
    const remainingStorageSlots = MAX_STORAGE_VOLUMES - existingVolumeCount;

    // If user already has max storage, they can't add more
    if (remainingStorageSlots <= 0) {
      // Build existingVolumes for max storage case too
      let maxExistingVolumes: Array<{ id: string; name: string; sizeGb: number }> = [];
      if (sharedVolumes.length > 0) {
        maxExistingVolumes = sharedVolumes.map((v: { id?: string; name?: string; size_gb?: number; size_in_gb?: number }) => ({
          id: v.id || "persistent",
          name: v.name || "Persistent Storage",
          sizeGb: v.size_gb || v.size_in_gb || 0,
        }));
      } else if (persistentStorageGb > 0) {
        maxExistingVolumes = [{
          id: "persistent",
          name: "Persistent Storage",
          sizeGb: persistentStorageGb,
        }];
      }

      return NextResponse.json({
        existingVolumeCount,
        maxStorageVolumes: MAX_STORAGE_VOLUMES,
        remainingStorageSlots: 0,
        existingVolumes: maxExistingVolumes,
        persistentStorageGb,
        dataSizeGb: null,
        storageOptions: [],
        error: `Maximum ${MAX_STORAGE_VOLUMES} storage volumes reached. Delete a volume to add another.`,
        canSaveData: false,
      });
    }

    // Get connection info for SSH
    const connectionInfo = await getConnectionInfo(teamId, subscriptionId);
    const subConnection = connectionInfo?.find(s => String(s.id) === String(subscriptionId));
    const targetPod = subConnection?.pods?.[0];

    if (!targetPod?.ssh_info) {
      return NextResponse.json({
        existingVolumeCount,
        maxStorageVolumes: MAX_STORAGE_VOLUMES,
        remainingStorageSlots,
        dataSizeGb: null,
        dataSizeError: "SSH info not available",
        storageOptions: [],
        canSaveData: false,
      });
    }

    // Calculate data size on the pod
    let dataSizeGb: number | null = null;
    let dataSizeError: string | null = null;

    try {
      const { cmd, pass } = targetPod.ssh_info;
      const { host, port, username } = parseSSHCommand(cmd);

      // Get size of home directory in bytes
      const sizeOutput = await executeSSHCommand(
        host, port, username, pass,
        "du -sb /home/ubuntu 2>/dev/null | cut -f1 || echo '0'"
      );

      const sizeBytes = parseInt(sizeOutput, 10) || 0;
      dataSizeGb = Math.ceil(sizeBytes / (1024 * 1024 * 1024)); // Round up to nearest GB

      // Minimum 10GB for safety
      if (dataSizeGb < 10) dataSizeGb = 10;
    } catch (err) {
      console.error("Failed to calculate data size:", err);
      dataSizeError = err instanceof Error ? err.message : "Failed to calculate size";
      dataSizeGb = 50; // Default to 50GB if can't calculate
    }

    // Get pool info for region
    const pools = await getAllPools();
    const pool = pools.find(p => String(p.id) === String(subscription.pool_id));
    const regionId = pool?.region_id || 2;

    // Get admin storage pricing (cents per GB per hour)
    const storagePriceCentsPerGBHour = getStoragePricePerGBHourCents();

    // Get available storage blocks
    let storageOptions: Array<{
      id: string;
      name: string;
      sizeGb: number;
      pricePerHour: number;
      monthlyEstimate: number;
      recommended: boolean;
      warning?: string;
    }> = [];

    try {
      const allBlocks = await getStorageBlocks();
      const sharedBlocks = allBlocks
        .filter(b => b.shared_storage_usage === true && b.is_available !== false)
        .sort((a, b) => (a.size_gb || a.size_in_gb || 0) - (b.size_gb || b.size_in_gb || 0));

      storageOptions = sharedBlocks
        .slice(0, 6)  // Limit to 6 options
        .map(b => {
          const sizeGb = b.size_gb || b.size_in_gb || 0;
          const isLargeEnough = sizeGb >= (dataSizeGb || 10);
          // Calculate price using admin config: sizeGB * (cents per GB per hour) / 100 = dollars per hour
          const pricePerHour = (sizeGb * storagePriceCentsPerGBHour) / 100;
          return {
            id: b.id,
            name: b.name,
            sizeGb,
            pricePerHour,
            monthlyEstimate: pricePerHour * 24 * 30,
            recommended: isLargeEnough,
            warning: !isLargeEnough ? `May be too small (need ~${dataSizeGb}GB)` : undefined,
          };
        });
    } catch (err) {
      console.error("Failed to get storage blocks:", err);
    }

    // Build existingVolumes array - include persistent_storage_gb if no shared_volumes
    let existingVolumes: Array<{ id: string; name: string; sizeGb: number }> = [];
    if (sharedVolumes.length > 0) {
      existingVolumes = sharedVolumes.map((v: { id?: string; name?: string; size_gb?: number; size_in_gb?: number }) => ({
        id: v.id || "persistent",
        name: v.name || "Persistent Storage",
        sizeGb: v.size_gb || v.size_in_gb || 0,
      }));
    } else if (persistentStorageGb > 0) {
      // User has persistent storage but it's not in shared_volumes array
      existingVolumes = [{
        id: "persistent",
        name: "Persistent Storage",
        sizeGb: persistentStorageGb,
      }];
    }

    return NextResponse.json({
      existingVolumeCount,
      maxStorageVolumes: MAX_STORAGE_VOLUMES,
      remainingStorageSlots,
      existingVolumes,
      persistentStorageGb, // Include this for debugging/display
      dataSizeGb,
      dataSizeError,
      storageOptions,
      storagePriceCentsPerGBHour,
      regionId,
      canSaveData: true,
      estimatedCopyTimeMinutes: Math.ceil((dataSizeGb || 10) / 10), // Rough estimate: 10GB/min
    });
  } catch (error) {
    console.error("Prepare snapshot error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to prepare snapshot" },
      { status: 500 }
    );
  }
}
