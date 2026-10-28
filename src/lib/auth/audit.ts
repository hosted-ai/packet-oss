// Audit log for the team RBAC surface. Writes to TeamAuditLog (append-only).
//
// Policy (from eng review round 2):
//   - ALL decisions (allow + deny) for 9 sensitive permissions:
//       gpu.provision, gpu.terminate, billing.manage, team.invite, team.manage,
//       team.transfer_ownership, api_keys.create, api_keys.revoke, ssh_keys.manage
//   - DENIES ONLY for 2 read-y permissions: billing.view, gpu.access
//   - 90-day TTL via cleanup cron (filed in TODOS.md).
//
// All writes are fire-and-forget: an audit log failure must NEVER break the
// request. Errors are logged and swallowed.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Permission } from "./role-permissions";
import type { AuthenticatedCustomer } from "./helpers";

const SENSITIVE_PERMISSIONS = new Set<Permission>([
  "gpu.provision",
  "gpu.terminate",
  "billing.manage",
  "team.invite",
  "team.manage",
  "api_keys.create",
  "api_keys.revoke",
  "ssh_keys.manage",
  // PA-202 module perms — mutations / resource creation, so audit allow + deny
  "token_factory.use",
  "huggingface.use",
  "apps.use",
  "storage.manage",
  "snapshots.manage",
]);

const DENY_ONLY_PERMISSIONS = new Set<Permission>([
  "billing.view",
  "gpu.access",
  // Referral is read-y; log only when denied (no point spamming the audit log
  // every time a teamAdmin loads their own referral page).
  "referral.view",
]);

function shouldLog(permission: Permission, allowed: boolean): boolean {
  if (SENSITIVE_PERMISSIONS.has(permission)) return true;
  if (DENY_ONLY_PERMISSIONS.has(permission) && !allowed) return true;
  return false;
}

export interface AuditContext {
  accountId: string;
  actorUserId: string | null;
  permission: Permission;
  allowed: boolean;
  route?: string;        // URL path that triggered the check
  payload?: unknown;     // Extra context (request body summary, target user, etc.)
}

export function recordPermissionDecision(ctx: AuditContext): void {
  if (!shouldLog(ctx.permission, ctx.allowed)) return;

  const action = ctx.allowed
    ? `permission.allowed.${ctx.permission}`
    : `permission.denied.${ctx.permission}`;

  const payloadJson = JSON.stringify({
    route: ctx.route,
    permission: ctx.permission,
    allowed: ctx.allowed,
    ...(ctx.payload && typeof ctx.payload === "object" ? { extra: ctx.payload } : {}),
  });

  // Fire-and-forget. Don't await in request path.
  prisma.teamAuditLog
    .create({
      data: {
        stripeCustomerId: ctx.accountId,
        actorUserId: ctx.actorUserId,
        action,
        payload: payloadJson,
      },
    })
    .catch((err) => {
      console.error("[auth/audit] Failed to write audit log:", err);
    });
}

// Convenience: bind audit recording to an AuthenticatedCustomer and return
// a 403 NextResponse + log the denial in one call.
//
//   if (!auth.can("gpu.provision")) {
//     return forbidden(auth, "gpu.provision", request);
//   }
export function forbidden(
  auth: AuthenticatedCustomer,
  permission: Permission,
  request?: Request,
  extra?: Record<string, unknown>,
): NextResponse {
  recordPermissionDecision({
    accountId: auth.accountId,
    actorUserId: auth.membership.userId,
    permission,
    allowed: false,
    route: request?.url ? new URL(request.url).pathname : undefined,
    payload: extra,
  });
  return NextResponse.json(
    {
      error: "You do not have permission to perform this action.",
      permission,
      role: auth.membership.role,
      isOwner: auth.membership.isOwner,
    },
    { status: 403 },
  );
}

// Convenience: assert a permission and audit the decision. Returns the 403
// NextResponse when denied (caller should `return` it). On allow, fires the
// audit-allowed write asynchronously and returns null.
export function requirePermission(
  auth: AuthenticatedCustomer,
  permission: Permission,
  request?: Request,
  extra?: Record<string, unknown>,
): NextResponse | null {
  const allowed = auth.can(permission);
  if (allowed) {
    recordPermissionDecision({
      accountId: auth.accountId,
      actorUserId: auth.membership.userId,
      permission,
      allowed: true,
      route: request?.url ? new URL(request.url).pathname : undefined,
      payload: extra,
    });
    return null;
  }
  return forbidden(auth, permission, request, extra);
}
