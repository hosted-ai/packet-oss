// PATCH /accounts/:accountId/members/:userId  — change a member's role.
// DELETE /accounts/:accountId/members/:userId  — remove a member.
//
// PA-201/PA-202 reconciliation:
//   - Owner (is_owner=TRUE) cannot be demoted (PATCH refuses).
//   - Owner (is_owner=TRUE) cannot be removed (DELETE refuses).
//   - No transfer-ownership mechanic.
//   - Multiple teamAdmins allowed; promotion is purely additive.
//
// HAI sync: when the new Packet role's derived HAI slug differs from the old,
// call HAI's change-user-role endpoint. STUBBED today — PR 3 known limitation.
// On removal, HAI removeUserFromTeam is also STUBBED.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";
import { prisma } from "@/lib/prisma";
import {
  PACKET_ROLES,
  getHaiRoleForPacketRole,
  type PacketRole,
} from "@/lib/auth/role-permissions";
import { getHaiRoleIdForPacketRole } from "@/lib/auth/hai-role-ids";
import { changeUserRole, removeUserFromTeam } from "@/lib/hostedai";
import { recomputeApiKeyPermissions, revokeApiKeysForRemovedMember } from "@/lib/auth/api-key-permissions";
import { removeMemberSshKeys } from "@/lib/auth/ssh-key-removal";
import { logTeamMemberRemoved } from "@/lib/activity";

function isPacketRole(role: string): role is PacketRole {
  return (PACKET_ROLES as readonly string[]).includes(role);
}

interface RouteContext {
  params: Promise<{ accountId: string; userId: string }>;
}

// PATCH — change member role.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;

  const { accountId, userId } = await params;

  if (accountId !== auth.accountId) {
    return NextResponse.json(
      { error: "You do not have access to this account." },
      { status: 403 },
    );
  }

  const denial = requirePermission(auth, "team.manage", request, { targetUserId: userId });
  if (denial) return denial;

  const body = (await request.json().catch(() => ({}))) as { role?: string };
  const newRole = body.role;

  if (!newRole || !isPacketRole(newRole)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${PACKET_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  const target = await prisma.teamMembership.findUnique({
    where: {
      userId_stripeCustomerId: { userId, stripeCustomerId: accountId },
    },
    include: { user: { select: { email: true } } },
  });

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.revokedAt) {
    return NextResponse.json({ error: "Cannot change role of a revoked member" }, { status: 400 });
  }

  // PA-201/PA-202: Owner is immutable. Cannot be demoted.
  if (target.isOwner) {
    return NextResponse.json(
      { error: "The account owner cannot be demoted. Owner role is immutable." },
      { status: 403 },
    );
  }

  // No-op if role unchanged.
  if (target.role === newRole) {
    return NextResponse.json({
      member: {
        id: target.id,
        userId: target.userId,
        role: target.role,
        isOwner: target.isOwner,
        changed: false,
      },
    });
  }

  // HAI sync only when the derived HAI slug actually changes (e.g., teamAdmin
  // ↔ non-teamAdmin). Same-side changes (member → readOnlyMember) skip HAI.
  const oldHaiSlug = isPacketRole(target.role)
    ? getHaiRoleForPacketRole(target.role, target.isOwner)
    : "teamMember";
  const newHaiSlug = getHaiRoleForPacketRole(newRole, target.isOwner);

  let haiSyncError: string | undefined;

  if (oldHaiSlug !== newHaiSlug) {
    try {
      const roleId = await getHaiRoleIdForPacketRole(newRole, target.isOwner);
      if (!auth.teamId) {
        return NextResponse.json(
          { error: "No HAI team associated with this account." },
          { status: 400 },
        );
      }
      await changeUserRole({
        teamId: auth.teamId,
        email: target.user.email,
        roleId,
      });
    } catch (err) {
      haiSyncError = err instanceof Error ? err.message : "HAI sync failed";
      console.error("[PATCH members] HAI sync failed:", err);
      // Packet update still proceeds — admin needs to reconcile via HAI panel.
    }
  }

  const updated = await prisma.teamMembership.update({
    where: { id: target.id },
    data: { role: newRole },
  });

  // PA-175 PR 2.5: recompute API key effective_permissions for this member.
  // Best-effort: if it fails, the role change is still applied (next request
  // will hit ROLE_PERMISSIONS directly if the key column happens to be null).
  let apiKeysRecomputed = 0;
  try {
    apiKeysRecomputed = await recomputeApiKeyPermissions({
      userId,
      accountId,
    });
  } catch (err) {
    console.error("[PATCH members] recomputeApiKeyPermissions failed:", err);
  }

  // Audit log entry for role change.
  await prisma.teamAuditLog
    .create({
      data: {
        stripeCustomerId: accountId,
        actorUserId: auth.membership.userId,
        subjectUserId: userId,
        action: "membership.role_changed",
        payload: JSON.stringify({
          from: target.role,
          to: newRole,
          haiSyncError,
        }),
      },
    })
    .catch((err) => console.error("[PATCH members] audit log failed:", err));

  return NextResponse.json({
    member: {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      isOwner: updated.isOwner,
      changed: true,
    },
    haiSyncError: haiSyncError ?? null,
    apiKeysRecomputed,
  });
}

// DELETE — remove (revoke) a member.
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;

  const { accountId, userId } = await params;

  if (accountId !== auth.accountId) {
    return NextResponse.json(
      { error: "You do not have access to this account." },
      { status: 403 },
    );
  }

  const denial = requirePermission(auth, "team.manage", request, { targetUserId: userId });
  if (denial) return denial;

  const target = await prisma.teamMembership.findUnique({
    where: {
      userId_stripeCustomerId: { userId, stripeCustomerId: accountId },
    },
    include: { user: { select: { email: true } } },
  });

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.revokedAt) {
    return NextResponse.json({ error: "Member is already revoked" }, { status: 400 });
  }

  // PA-201/PA-202: Owner cannot be removed.
  if (target.isOwner) {
    return NextResponse.json(
      { error: "The account owner cannot be removed. Owner is immutable." },
      { status: 403 },
    );
  }

  // HAI sync. Best-effort — Packet-side revocation is the primary barrier.
  let haiSyncError: string | undefined;
  if (auth.teamId) {
    try {
      await removeUserFromTeam({ teamId: auth.teamId, email: target.user.email });
    } catch (err) {
      haiSyncError = err instanceof Error ? err.message : "HAI sync failed";
      console.error("[DELETE members] HAI sync failed:", err);
    }
  }

  const revoked = await prisma.teamMembership.update({
    where: { id: target.id },
    data: { revokedAt: new Date(), status: "revoked" },
  });

  // PA-175 PR 2.5: revoke API keys + remove SSH keys for the removed member.
  // Best-effort: the membership revocation is the primary security barrier
  // (next request via that user's JWT 403s); these are belt-and-suspenders
  // for the API-key auth path and the long-running SSH-session case.
  let apiKeysRevoked = 0;
  let sshKeysRemoved = 0;
  let podsTouched = 0;
  try {
    apiKeysRevoked = await revokeApiKeysForRemovedMember({ userId, accountId });
  } catch (err) {
    console.error("[DELETE members] revokeApiKeysForRemovedMember failed:", err);
  }
  try {
    const result = await removeMemberSshKeys({ userId, accountId });
    sshKeysRemoved = result.keysRemoved;
    podsTouched = result.podsTouched;
  } catch (err) {
    console.error("[DELETE members] removeMemberSshKeys failed:", err);
  }

  await prisma.teamAuditLog
    .create({
      data: {
        stripeCustomerId: accountId,
        actorUserId: auth.membership.userId,
        subjectUserId: userId,
        action: "membership.removed",
        payload: JSON.stringify({
          revokedRole: target.role,
          haiSyncError,
          apiKeysRevoked,
          sshKeysRemoved,
          podsTouched,
        }),
      },
    })
    .catch((err) => console.error("[DELETE members] audit log failed:", err));

  logTeamMemberRemoved(accountId, target.user.email).catch(() => {});

  return NextResponse.json({
    member: {
      id: revoked.id,
      userId: revoked.userId,
      revokedAt: revoked.revokedAt?.toISOString(),
      status: revoked.status,
    },
    haiSyncError: haiSyncError ?? null,
    apiKeysRevoked,
    sshKeysRemoved,
    podsTouched,
  });
}
