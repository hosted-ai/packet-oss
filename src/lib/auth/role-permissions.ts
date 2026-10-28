// Source of truth for Packet's permission model. Keyed by Packet's role enum.
// HAI gets a derived coarser role via getHaiRoleForPacketRole().
//
// Reconciled against PA-201 + PA-202 on 2026-05-18:
//   * "Team Admin" is the single elevated role (PA-201 dropped the separate
//     "Owner" role name). Slug: `teamAdmin`. Multiple Team Admins are allowed
//     per account.
//   * `is_owner` is an immutable Packet-only FLAG marking the Stripe-linked
//     account creator. NOT a role. Used only for "cannot remove / cannot
//     demote" protection. Always coexists with `role='teamAdmin'`.
//   * No transfer-ownership mechanic. The Owner flag never moves.
//   * "Team Member" can start/stop/terminate instances + SSH (per PA-201
//     matrix). "Read-only Member" can only SSH; cannot mutate lifecycle.
//   * "Finance Manager" sees billing only; cannot SSH, cannot mutate.
//
//  ┌───────────────────────┐         ┌────────────────────────────────┐
//  │ team_memberships      │  reads  │ ROLE_PERMISSIONS (this file)   │
//  │  - role: PacketRole   │  ────▶  │ {                              │
//  │  - is_owner: boolean  │         │   teamAdmin:      { ... }      │
//  │  - revoked_at         │         │   member:         { ... }      │
//  └───────────────────────┘         │   readOnlyMember: { ... }      │
//             │                       │   financeManager: { ... }      │
//             │                       │ }                              │
//             │                       └────────────────────────────────┘
//             │                                  │
//             ▼                                  ▼
//      can(role, isOwner, permission)   →  bool
//
// When HAI ships readOnlyMember + financeManager slugs, only
// getHaiRoleForPacketRole() needs to change.

// HAI now ships all four role slugs (synced 2026-05-19). Kept as a
// literal union here so this module stays client-safe — we deliberately
// don't `import type` from @/lib/hostedai because even type-only imports
// can leak into browser bundles when mixed with runtime imports.
export type HaiRoleSlug =
  | "teamAdmin"
  | "teamMember"
  | "readOnlyMember"
  | "financeManager";

export const PERMISSIONS = [
  // Instance lifecycle + access
  "gpu.provision",
  "gpu.terminate",
  "gpu.access",
  // Billing
  "billing.view",
  "billing.manage",
  // Team management
  "team.invite",
  "team.manage",
  // API keys
  "api_keys.create",
  "api_keys.revoke",
  // SSH keys
  "ssh_keys.manage",
  // PA-202 module permissions (added 2026-05-18)
  "token_factory.use",
  "huggingface.use",
  "apps.use",
  "referral.view",
  "storage.manage",
  "snapshots.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// PA-201 reconciliation (2026-05-18): `team.transfer_ownership` was removed.
// The Owner flag (is_owner) is now an immutable Stripe-linked marker — there
// is no transfer mechanic. If we ever need to transfer the Stripe-linked
// identity, that becomes a billing-side admin action, not a member-facing perm.

export const PACKET_ROLES = ["teamAdmin", "member", "readOnlyMember", "financeManager"] as const;
export type PacketRole = (typeof PACKET_ROLES)[number];

export interface RoleConfig {
  slug: PacketRole;
  displayName: string;
  summary: string;
  permissions: ReadonlySet<Permission>;
}

export const ROLE_PERMISSIONS: Record<PacketRole, RoleConfig> = {
  teamAdmin: {
    slug: "teamAdmin",
    displayName: "Team Admin",
    summary:
      "Full access. Manages GPUs, members, billing, payment methods, and API keys. Multiple Team Admins are allowed per account; the original Stripe-linked Team Admin (is_owner=TRUE) cannot be removed or demoted.",
    permissions: new Set<Permission>([
      "gpu.provision",
      "gpu.terminate",
      "gpu.access",
      "billing.view",
      "billing.manage",
      "team.invite",
      "team.manage",
      "api_keys.create",
      "api_keys.revoke",
      "ssh_keys.manage",
      "token_factory.use",
      "huggingface.use",
      "apps.use",
      "referral.view",
      "storage.manage",
      "snapshots.manage",
    ]),
  },
  member: {
    slug: "member",
    displayName: "Team Member",
    summary:
      "Operates infrastructure: deploys, stops, terminates GPUs, SSHes into instances, uses inference and apps. Cannot see billing, manage team, or access referral.",
    permissions: new Set<Permission>([
      "gpu.provision",
      "gpu.terminate",
      "gpu.access",
      "api_keys.create",
      "api_keys.revoke",
      "ssh_keys.manage",
      // PA-202: Team Members get module access (Token Factory, HF, Apps, storage, snapshots)
      // but NOT referral (Team Admin only per PA-201).
      "token_factory.use",
      "huggingface.use",
      "apps.use",
      "storage.manage",
      "snapshots.manage",
    ]),
  },
  readOnlyMember: {
    slug: "readOnlyMember",
    displayName: "Read-only Member",
    summary:
      "SSH-only access to running GPUs. Cannot deploy, stop, terminate, or see billing. No module access (Token Factory, HF, Apps all hidden). HAI side: collapses to teamMember today; distinct slug coming.",
    permissions: new Set<Permission>(["gpu.access", "ssh_keys.manage"]),
  },
  financeManager: {
    slug: "financeManager",
    displayName: "Finance Manager",
    summary:
      "Manages billing, payment methods, and wallet top-ups. Read-only visibility into instances; no SSH/access; cannot deploy, stop, or terminate; no module access.",
    permissions: new Set<Permission>(["billing.view", "billing.manage"]),
  },
};

// Boot-time validation: catch drift between PACKET_ROLES and ROLE_PERMISSIONS.
// Runs once at module load. Throws on missing entries or unknown permissions.
for (const role of PACKET_ROLES) {
  const config = ROLE_PERMISSIONS[role];
  if (!config) {
    throw new Error(`[role-permissions] Missing ROLE_PERMISSIONS entry for role: ${role}`);
  }
  if (config.slug !== role) {
    throw new Error(
      `[role-permissions] ROLE_PERMISSIONS['${role}'].slug='${config.slug}' does not match key`,
    );
  }
  for (const perm of config.permissions) {
    if (!PERMISSIONS.includes(perm)) {
      throw new Error(`[role-permissions] Role '${role}' has unknown permission: ${perm}`);
    }
  }
}

// Pure permission resolution. Reads (role, isOwner) from a team_memberships row
// and returns whether the user can perform the given action on that account.
//
// Resolution order:
//   1. isOwner === true  → allow (defensive short-circuit — Owner is always
//      `role='teamAdmin'`, so this is semantically equivalent to the role
//      check below. Kept as a safety net against data corruption.)
//   2. role missing      → deny (default-deny for safety)
//   3. otherwise         → lookup in ROLE_PERMISSIONS
//
// Callers should have already checked membership.revoked_at != null and denied.
// This function intentionally does NOT take revoked_at — that's a caller concern.
export function can(
  role: PacketRole | null | undefined,
  isOwner: boolean,
  permission: Permission,
): boolean {
  if (isOwner) return true;
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.permissions.has(permission) ?? false;
}

// Derives the HAI role slug for a Packet (role, isOwner) pair.
//
// Now a 1:1 mapping — HAI ships all four slugs as of 2026-05-19. The Owner
// flag still forces teamAdmin since the original Stripe-linked creator
// always has full admin access regardless of the role column value.
//
// Used by: invite accept (createOneTimeLogin), role change (HAI change-role).
export function getHaiRoleForPacketRole(role: PacketRole, isOwner: boolean): HaiRoleSlug {
  if (isOwner) return "teamAdmin";
  switch (role) {
    case "teamAdmin":
      return "teamAdmin";
    case "member":
      return "teamMember";
    case "readOnlyMember":
      return "readOnlyMember";
    case "financeManager":
      return "financeManager";
  }
}

// Async resolver to the HAI role UUID lives in @/lib/auth/hai-role-ids
// (server-only — keeps this file safe to import from Client Components).
