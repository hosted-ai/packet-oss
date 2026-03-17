import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import {
  getPoolSubscriptions,
  getConnectionInfo,
  getAllPools,
  createSharedVolume,
  unsubscribeFromPool,
  subscribeToPool,
  getPoolEphemeralStorageBlocks,
  getSharedVolumes,
  getApiUrl,
  getApiKey,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import { z } from "zod";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";

const createSnapshotSchema = z.object({
  displayName: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  saveData: z.boolean().optional().default(false),
  storageBlockId: z.string().optional(), // Required if saveData is true and no existing storage
  terminateAfterSave: z.boolean().optional().default(false),
});

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
  timeoutMs: number = 300000 // 5 minutes default for data copy
): Promise<{ success: boolean; output: string }> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
    const encodedCommand = Buffer.from(command).toString("base64");
    const remoteCommand = `echo '${encodedCommand}' | base64 -d | bash`;

    const args = [
      "-e",
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=20",
      "-p", String(port),
      `${username}@${host}`,
      remoteCommand
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
      resolve({
        success: code === 0,
        output: stdout + (stderr ? "\n" + stderr : ""),
      });
    });

    proc.on("error", (err) => {
      resolve({ success: false, output: err.message });
    });

    setTimeout(() => {
      proc.kill();
      resolve({ success: false, output: "Command timed out" });
    }, timeoutMs);
  });
}

// Wait for pod to be ready with SSH access
async function waitForPodReady(
  teamId: string,
  poolId: string,
  maxWaitMs: number = 120000
): Promise<{ subscriptionId: string; sshInfo: { cmd: string; pass: string } } | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      const subscriptions = await getPoolSubscriptions(teamId);
      const sub = subscriptions.find(s =>
        String(s.pool_id) === String(poolId) &&
        (s.status === "subscribed" || s.status === "active")
      );

      if (!sub) continue;

      const connectionInfo = await getConnectionInfo(teamId, String(sub.id));
      const subConnection = connectionInfo?.find(c => String(c.id) === String(sub.id));
      const pod = subConnection?.pods?.[0];

      if (pod?.ssh_info?.cmd && pod?.ssh_info?.pass) {
        return {
          subscriptionId: String(sub.id),
          sshInfo: { cmd: pod.ssh_info.cmd, pass: pod.ssh_info.pass },
        };
      }
    } catch (err) {
      console.error("Error waiting for pod:", err);
    }
  }

  return null;
}

// POST - Create a snapshot of the current pod configuration
export async function POST(
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
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { id: subscriptionId } = await params;
    const body = await request.json();

    // Validate input
    const parsed = createSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { displayName, notes, saveData, storageBlockId, terminateAfterSave } = parsed.data;

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

    // Get the current subscription details from hosted.ai
    const subscriptions = await getPoolSubscriptions(teamId);
    const subscription = subscriptions.find(
      (s) => String(s.id) === String(subscriptionId)
    );

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // Extract subscription data for snapshot
    const poolId = String(subscription.pool_id);
    const poolName = subscription.pool_name || null;
    const vgpus = subscription.per_pod_info?.vgpu_count || subscription.gpu_count || 1;
    const imageUuid = subscription.per_pod_info?.image_uuid || null;

    // Get pool info for region
    const pools = await getAllPools();
    const pool = pools.find(p => String(p.id) === poolId);
    const regionId = pool?.region_id || 2;

    // Get shared volumes (persistent storage)
    // Storage can be in shared_volumes array OR indicated by persistent_storage_gb field
    // IMPORTANT: subscription.storage_details.shared_volumes may be null/empty even when storage exists
    // So we MUST also check getSharedVolumes() API to find volumes belonging to this team
    let sharedVolumes = subscription.storage_details?.shared_volumes || [];
    const persistentStorageGb = subscription.storage_details?.persistent_storage_gb || 0;

    // If shared_volumes is empty but persistent_storage_gb indicates storage exists,
    // fetch volumes from the dedicated API to find the actual volume IDs
    if (sharedVolumes.length === 0 && persistentStorageGb > 0) {
      console.log(`[Snapshot] subscription shows ${persistentStorageGb}GB storage but shared_volumes is empty, fetching via API...`);
      try {
        const allTeamVolumes = await getSharedVolumes(teamId);
        console.log(`[Snapshot] Found ${allTeamVolumes.length} volumes for team ${teamId}:`,
          allTeamVolumes.map(v => ({ id: v.id, name: v.name, size: v.size_in_gb, status: v.status })));

        // Find volumes that are IN_USE - these are attached to subscriptions
        const inUseVolumes = allTeamVolumes.filter(v => v.status === "IN_USE");
        if (inUseVolumes.length > 0) {
          // Use the in-use volumes as our shared volumes
          sharedVolumes = inUseVolumes.map(v => ({
            id: String(v.id),
            name: v.name,
            size_in_gb: v.size_in_gb,
            size_gb: v.size_in_gb,
          }));
          console.log(`[Snapshot] Using ${sharedVolumes.length} IN_USE volumes for snapshot`);
        } else if (allTeamVolumes.length > 0) {
          // If no IN_USE volumes but volumes exist, use all available ones
          // This handles edge cases where status might not be set correctly
          sharedVolumes = allTeamVolumes.map(v => ({
            id: String(v.id),
            name: v.name,
            size_in_gb: v.size_in_gb,
            size_gb: v.size_in_gb,
          }));
          console.log(`[Snapshot] No IN_USE volumes, using all ${sharedVolumes.length} volumes`);
        }
      } catch (volumeErr) {
        console.error(`[Snapshot] Failed to fetch shared volumes:`, volumeErr);
        // Continue without volumes - snapshot will work but won't have storage attached
      }
    }

    let existingVolumeIds = sharedVolumes.map(v => Number(v.id)).filter(id => !isNaN(id));
    // User has storage if they have shared volumes OR persistent_storage_gb is set
    let hasStorage = sharedVolumes.length > 0 || persistentStorageGb > 0;
    let autoCreatedVolume = false;
    let usedStorageBlockId: string | null = null;
    let newVolumeId: number | null = null;

    // Maximum 3 storage volumes per pod
    const MAX_STORAGE_VOLUMES = 3;

    // If saveData is true AND user doesn't already have storage, create new storage
    // If user already has storage, their data is already preserved - no need to resubscribe
    if (saveData && !hasStorage) {
      // Check if user already has max storage volumes
      if (existingVolumeIds.length >= MAX_STORAGE_VOLUMES) {
        return NextResponse.json(
          { error: `Maximum ${MAX_STORAGE_VOLUMES} storage volumes allowed per pod. Please delete a storage volume first.` },
          { status: 400 }
        );
      }

      if (!storageBlockId) {
        return NextResponse.json(
          { error: "storageBlockId is required when saving data" },
          { status: 400 }
        );
      }

      console.log("Creating auto-storage for snapshot:", { subscriptionId, storageBlockId });

      // Step 1: Create shared volume
      const volumeName = `snapshot-${subscriptionId}-${Date.now()}`;
      try {
        const volume = await createSharedVolume({
          team_id: teamId,
          region_id: regionId,
          name: volumeName,
          storage_block_id: storageBlockId,
        });
        newVolumeId = volume.id;
        autoCreatedVolume = true;
        usedStorageBlockId = storageBlockId;
        console.log("Created snapshot volume:", volume);
      } catch (err) {
        console.error("Failed to create volume:", err);
        return NextResponse.json(
          { error: "Failed to create storage volume" },
          { status: 500 }
        );
      }

      // Step 2: Resubscribe with the new volume
      console.log("Resubscribing with snapshot volume...");

      // Get ephemeral storage block
      let ephemeralStorageBlockId: string | undefined;
      try {
        const ephemeralBlocks = await getPoolEphemeralStorageBlocks(String(regionId), teamId);
        if (ephemeralBlocks.length > 0) {
          ephemeralStorageBlockId = ephemeralBlocks[0].id;
        }
      } catch (err) {
        console.error("Failed to get ephemeral storage:", err);
      }

      if (!ephemeralStorageBlockId) {
        return NextResponse.json(
          { error: "Could not determine ephemeral storage configuration" },
          { status: 500 }
        );
      }

      // Get instance type
      const [apiUrl, apiKey] = await Promise.all([getApiUrl(), getApiKey()]);

      let instanceTypeId: string | undefined;
      try {
        const response = await fetch(`${apiUrl}/api/instance-type`, {
          method: "GET",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        });

        if (response.ok) {
          const allTypes = await response.json() as Array<{
            id: string;
            name: string;
            gpu_workload: boolean;
            is_available: boolean;
          }>;

          const gpuTypes = allTypes.filter(t => t.gpu_workload === true && t.is_available !== false);
          const mediumType = gpuTypes.find(t => t.name === "Medium");
          instanceTypeId = mediumType ? mediumType.id : gpuTypes[0]?.id;
        }
      } catch (err) {
        console.error("Failed to get instance types:", err);
      }

      if (!instanceTypeId) {
        return NextResponse.json(
          { error: "Could not determine instance type configuration" },
          { status: 500 }
        );
      }

      // Unsubscribe from current
      try {
        await unsubscribeFromPool(subscriptionId, teamId, poolId);
      } catch (err) {
        console.error("Failed to unsubscribe:", err);
      }

      // Wait for unsubscribe
      const maxUnsubWaitMs = 60000;
      const unsubStartTime = Date.now();
      while (Date.now() - unsubStartTime < maxUnsubWaitMs) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const subs = await getPoolSubscriptions(teamId);
        const existingSub = subs.find(s => String(s.id) === String(subscriptionId));
        if (!existingSub) break;
        if (existingSub.status === "un_subscribing") continue;
      }

      // Resubscribe with all existing volumes PLUS the new snapshot volume
      const allVolumeIds = [...existingVolumeIds, newVolumeId!];
      console.log("Subscribing with volumes:", allVolumeIds);
      try {
        await subscribeToPool({
          pool_id: poolId,
          team_id: teamId,
          vgpus,
          instance_type_id: instanceTypeId,
          ephemeral_storage_block_id: ephemeralStorageBlockId,
          shared_volumes: allVolumeIds,
          image_uuid: imageUuid || undefined,
        });
      } catch (err) {
        console.error("Failed to resubscribe:", err);
        return NextResponse.json(
          { error: "Failed to attach storage volume" },
          { status: 500 }
        );
      }

      // Step 3: Wait for pod to be ready
      console.log("Waiting for pod to be ready...");
      const podReady = await waitForPodReady(teamId, poolId, 180000); // 3 minutes max

      if (!podReady) {
        return NextResponse.json(
          { error: "Pod did not become ready in time" },
          { status: 500 }
        );
      }

      // Step 4: Copy data from ephemeral to persistent storage
      console.log("Copying data to persistent storage...");
      const { cmd, pass } = podReady.sshInfo;
      const { host, port, username } = parseSSHCommand(cmd);

      // The persistent volume is mounted at /mnt/shared-volumes/<volume-name>
      // Copy user's home directory data to it
      const copyScript = `
#!/bin/bash
set -e

# Find the mounted shared volume
MOUNT_DIR=$(ls -d /mnt/shared-volumes/*/ 2>/dev/null | head -1)
if [ -z "$MOUNT_DIR" ]; then
  echo "No shared volume mounted"
  exit 1
fi

echo "Copying data to $MOUNT_DIR..."

# Create a snapshot subdirectory
SNAPSHOT_DIR="$MOUNT_DIR/snapshot-data"
mkdir -p "$SNAPSHOT_DIR"

# Copy home directory contents (excluding caches)
rsync -a --info=progress2 \
  --exclude '.cache' \
  --exclude '__pycache__' \
  --exclude 'node_modules' \
  --exclude '.venv' \
  --exclude '*.pyc' \
  /home/ubuntu/ "$SNAPSHOT_DIR/home-ubuntu/" 2>&1 || true

# Copy any workspace data
if [ -d "/workspace" ]; then
  rsync -a --info=progress2 /workspace/ "$SNAPSHOT_DIR/workspace/" 2>&1 || true
fi

# Copy HuggingFace cache if exists
if [ -d "/home/ubuntu/.cache/huggingface" ]; then
  mkdir -p "$SNAPSHOT_DIR/hf-cache"
  rsync -a --info=progress2 /home/ubuntu/.cache/huggingface/ "$SNAPSHOT_DIR/hf-cache/" 2>&1 || true
fi

echo "Data copy complete"
du -sh "$SNAPSHOT_DIR"
`;

      const copyResult = await executeSSHCommand(host, port, username, pass, copyScript, 600000); // 10 min timeout

      if (!copyResult.success) {
        console.error("Data copy failed:", copyResult.output);
        // Continue anyway - snapshot will be created but data might be incomplete
      } else {
        console.log("Data copy result:", copyResult.output);
      }

      // Update subscription info for snapshot
      const newSubs = await getPoolSubscriptions(teamId);
      const newSub = newSubs.find(s => String(s.pool_id) === poolId && s.status === "subscribed");
      if (newSub) {
        sharedVolumes = newSub.storage_details?.shared_volumes || [];
        hasStorage = sharedVolumes.length > 0;
      }
    }

    const firstVolume = sharedVolumes[0];

    // Determine storage volume info - prefer shared_volumes, fallback to persistent_storage_gb
    const volumeId = newVolumeId || (firstVolume?.id ? Number(firstVolume.id) : null);
    const volumeName = firstVolume?.name || (persistentStorageGb > 0 ? "Persistent Storage" : null);
    const volumeSize = firstVolume?.size_in_gb || firstVolume?.size_gb || persistentStorageGb || null;

    // Get HuggingFace deployment info if exists
    const hfDeployment = await prisma.huggingFaceDeployment.findFirst({
      where: { subscriptionId: String(subscriptionId) },
    });

    // Determine snapshot type
    const snapshotType = hasStorage ? "full" : "template";

    // Create the snapshot
    const snapshot = await prisma.podSnapshot.create({
      data: {
        stripeCustomerId: payload.customerId,
        displayName,
        notes: notes || null,
        snapshotType,
        originalSubscriptionId: String(subscriptionId),
        poolId,
        poolName,
        regionId: String(regionId),
        vgpus,
        instanceTypeId: null,
        imageUuid,
        persistentVolumeId: volumeId,
        persistentVolumeName: volumeName,
        persistentVolumeSize: volumeSize,
        autoCreatedVolume,
        storageBlockId: usedStorageBlockId,
        hfItemId: hfDeployment?.hfItemId || null,
        hfItemType: hfDeployment?.hfItemType || null,
        hfItemName: hfDeployment?.hfItemName || null,
        deployScript: hfDeployment?.deployScript || null,
      },
    });

    // Optionally terminate the pod after saving
    if (terminateAfterSave) {
      console.log("Terminating pod after snapshot save...");
      try {
        // Get current subscription ID (might have changed after resubscribe)
        const currentSubs = await getPoolSubscriptions(teamId);
        const currentSub = currentSubs.find(s =>
          String(s.pool_id) === poolId &&
          (s.status === "subscribed" || s.status === "active")
        );
        if (currentSub) {
          await unsubscribeFromPool(String(currentSub.id), teamId, poolId);
        }
      } catch (err) {
        console.error("Failed to terminate after save:", err);
        // Don't fail the whole operation
      }
    }

    return NextResponse.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        displayName: snapshot.displayName,
        snapshotType: snapshot.snapshotType,
        poolName: snapshot.poolName,
        vgpus: snapshot.vgpus,
        hasStorage: hasStorage,
        storageName: snapshot.persistentVolumeName,
        storageSize: snapshot.persistentVolumeSize,
        autoCreatedVolume,
        hfModel: snapshot.hfItemName,
        createdAt: snapshot.createdAt,
      },
      dataCopied: saveData && autoCreatedVolume,
      terminated: terminateAfterSave,
    });
  } catch (error) {
    console.error("Create snapshot error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create snapshot" },
      { status: 500 }
    );
  }
}
