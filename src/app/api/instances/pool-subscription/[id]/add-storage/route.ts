import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import {
  getUnifiedInstanceDetail,
  getSharedVolumes,
  getSharedStorageBlocks,
  createSharedVolume,
  podVolumeAction,
} from "@/lib/hostedai";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// HAI resolves an attach against AVAILABLE or IN_USE (db/shared_volumes.go); a
// volume being mounted elsewhere does not make it unattachable.
const ATTACHABLE_STATUSES = new Set(["AVAILABLE", "IN_USE"]);

function isAttachableStatus(status?: string | null): boolean {
  return ATTACHABLE_STATUSES.has((status || "").toUpperCase());
}

// GET - Get storage info for an instance: attached volumes, available volumes, block sizes
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: instanceId } = await context.params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // PA-175: resolve operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const teamId = ctx.teamId;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // PA-295: this GET returns the create-volume flow (attachable volumes +
    // block sizes) — the same managed read the sibling storage-blocks GET
    // gates — so require storage.manage here too, matching the POST below.
    // (The ungated shared-volumes *list* GET stays the read-only "view your
    // storage" affordance; this endpoint feeds the manage/attach flow.)
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "storage.manage",
      request,
      extra: { instanceId, action: "add-storage-options" },
    });
    if (denial) return denial;

    // Get instance details (region, attached volumes)
    const instance = await getUnifiedInstanceDetail(instanceId);
    if (!instance) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    const regionId = instance.region?.id;
    if (!regionId) {
      return NextResponse.json({ error: "Could not determine instance region" }, { status: 400 });
    }

    // Attached volume IDs to exclude from available list
    const attachedVolumeIds = new Set(
      (instance.shared_volumes || []).map((v) => v.id)
    );

    // Swallowing these made an upstream failure indistinguishable from "this
    // region has nothing" — the caller needs to tell the two apart.
    const [volumesResult, blocksResult] = await Promise.allSettled([
      getSharedVolumes(teamId),
      getSharedStorageBlocks(regionId, teamId),
    ]);
    if (volumesResult.status === "rejected") {
      console.error("[AddStorage] Failed to list team volumes:", volumesResult.reason);
    }
    if (blocksResult.status === "rejected") {
      console.error(`[AddStorage] Failed to list storage blocks for region ${regionId}:`, blocksResult.reason);
    }
    const teamVolumes = volumesResult.status === "fulfilled" ? volumesResult.value : [];
    const storageBlocks = blocksResult.status === "fulfilled" ? blocksResult.value : [];

    // A volume mounted on another instance is still attachable here — that is what
    // shared storage is for, and HAI resolves both statuses. Only a volume already
    // on THIS instance is excluded.
    const availableVolumes = teamVolumes
      .filter(
        (v) =>
          v.region_id === regionId &&
          !attachedVolumeIds.has(v.id) &&
          isAttachableStatus(v.status)
      )
      .map((v) => ({
        id: v.id,
        name: v.name,
        size_in_gb: v.size_in_gb,
        mount_point: v.mount_point,
        cost: v.cost,
        status: v.status,
      }));

    return NextResponse.json({
      instanceId,
      regionId,
      attachedVolumes: instance.shared_volumes || [],
      availableVolumes,
      storageBlocks: [...storageBlocks].sort((a, b) => a.size - b.size),
      hasSharedStorageSupport: instance.region?.has_shared_storage_support ?? true,
      loadFailed: volumesResult.status === "rejected" || blocksResult.status === "rejected",
    });
  } catch (error) {
    console.error("Get storage options error:", error);
    const msg = error instanceof Error ? error.message : "Failed to get storage options";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST - Attach a volume to a running instance or create + attach
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: instanceId } = await context.params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // PA-175: resolve operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const customer = ctx.customer;
    const teamId = ctx.teamId;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // PA-175 gate: attaching storage is a managed action.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "storage.manage",
      request,
      extra: { instanceId, action: "add-storage" },
    });
    if (denial) return denial;

    const body = await request.json();
    const { volume_id, storage_block_id } = body;

    if (!volume_id && !storage_block_id) {
      return NextResponse.json(
        { error: "Either volume_id (attach existing) or storage_block_id (create new) is required" },
        { status: 400 }
      );
    }

    // Get instance to verify ownership and get region
    const instance = await getUnifiedInstanceDetail(instanceId);
    if (!instance) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    // Verify instance belongs to this team
    if (instance.team?.id !== teamId) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    const regionId = instance.region?.id;
    if (!regionId) {
      return NextResponse.json({ error: "Could not determine instance region" }, { status: 400 });
    }

    // PA-327: same capability gate as the create flow — don't accept an
    // attach request HAI will never resolve.
    if (instance.region?.has_shared_storage_support === false) {
      return NextResponse.json(
        { error: "Shared storage is not supported for this instance's region/GPU type." },
        { status: 400 }
      );
    }

    let attachVolumeId: number;

    if (volume_id) {
      // Attach existing volume — verify it belongs to this team and is available
      const teamVolumes = await getSharedVolumes(teamId);
      const vol = teamVolumes.find((v) => v.id === Number(volume_id));
      if (!vol) {
        return NextResponse.json({ error: "Volume not found or does not belong to your team" }, { status: 404 });
      }
      if (vol.region_id !== regionId) {
        return NextResponse.json({ error: "Volume is in a different region than the instance" }, { status: 400 });
      }
      const alreadyOnThisInstance = (instance.shared_volumes || []).some((v) => v.id === vol.id);
      if (alreadyOnThisInstance) {
        return NextResponse.json({ error: "Volume is already attached to this instance" }, { status: 400 });
      }
      if (!isAttachableStatus(vol.status)) {
        return NextResponse.json({ error: `Volume is not available (status: ${vol.status})` }, { status: 400 });
      }
      attachVolumeId = vol.id;
    } else {
      // Create new volume then attach
      const volumeName = `${instance.name}-storage-${Date.now()}`;
      const volume = await createSharedVolume({
        team_id: teamId,
        region_id: regionId,
        name: volumeName,
        storage_block_id,
      });
      attachVolumeId = volume.id;
      console.log(`[AddStorage] Created volume ${volume.id} (${volume.name}) for instance ${instanceId}`);
    }

    // Attach volume to running instance
    console.log(`[AddStorage] Attaching volume ${attachVolumeId} to instance ${instanceId}`);
    await podVolumeAction(instanceId, "attach_volume", [attachVolumeId]);

    return NextResponse.json({
      success: true,
      volume_id: attachVolumeId,
      message: "Storage volume is being attached. The GPU will restart briefly.",
    });
  } catch (error) {
    console.error("Add storage error:", error);
    const msg = error instanceof Error ? error.message : "Failed to add storage";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
