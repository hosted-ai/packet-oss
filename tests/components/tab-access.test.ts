/**
 * PA-269 — dashboard tab view-guard.
 *
 * The sidebar hides permission-gated tabs, but `?tab=<x>` still mounts them on
 * direct navigation. isTabAllowed() is the pure predicate DashboardContent uses
 * to bounce a user who lands on a tab they can't view back to the dashboard.
 *
 * The predicates here MUST mirror the sidebar conditions in DashboardContent.
 */
import { describe, it, expect } from "vitest";
import { isTabAllowed, TAB_VIEW_GUARDS } from "@/app/dashboard/components/tab-access";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type PacketRole,
  type Permission,
} from "@/lib/auth/role-permissions";

type CanMap = Partial<Record<Permission, boolean>>;

// Build the can-map the way /api/account/verify does: every permission keyed to
// whether the role (or owner) has it.
function canFor(role: PacketRole, isOwner = false): CanMap {
  const granted = ROLE_PERMISSIONS[role].permissions;
  return Object.fromEntries(
    PERMISSIONS.map((p) => [p, isOwner || granted.has(p)]),
  ) as CanMap;
}

describe("isTabAllowed — PA-269 tab view-guard", () => {
  it("always allows ungated tabs regardless of permissions", () => {
    const none: CanMap = {};
    for (const tab of ["dashboard", "team", "settings", "support", "keys"] as const) {
      expect(isTabAllowed(tab, none)).toBe(true);
    }
  });

  it("does not redirect before the can-map is loaded (null/undefined → allowed)", () => {
    expect(isTabAllowed("billing", null)).toBe(true);
    expect(isTabAllowed("billing", undefined)).toBe(true);
  });

  it("billing requires billing.view", () => {
    expect(isTabAllowed("billing", { "billing.view": true })).toBe(true);
    expect(isTabAllowed("billing", { "billing.view": false })).toBe(false);
    expect(isTabAllowed("billing", {})).toBe(false);
  });

  it("storage + metrics require gpu.access OR billing.view", () => {
    for (const tab of ["storage", "metrics"] as const) {
      expect(isTabAllowed(tab, { "gpu.access": true })).toBe(true);
      expect(isTabAllowed(tab, { "billing.view": true })).toBe(true);
      expect(isTabAllowed(tab, {})).toBe(false);
    }
  });

  it("matches the role matrix for the Billing tab", () => {
    expect(isTabAllowed("billing", canFor("teamAdmin"))).toBe(true);
    expect(isTabAllowed("billing", canFor("financeManager"))).toBe(true);
    expect(isTabAllowed("billing", canFor("member"))).toBe(false);
    expect(isTabAllowed("billing", canFor("readOnlyMember"))).toBe(false);
    expect(isTabAllowed("billing", canFor("member", true))).toBe(true); // owner override
  });

  it("matches the role matrix for module tabs (huggingface, apps)", () => {
    // Team Member has module access; Read-only Member + Finance Manager do not.
    expect(isTabAllowed("huggingface", canFor("member"))).toBe(true);
    expect(isTabAllowed("apps", canFor("member"))).toBe(true);
    expect(isTabAllowed("huggingface", canFor("readOnlyMember"))).toBe(false);
    expect(isTabAllowed("apps", canFor("financeManager"))).toBe(false);
  });

  it("readOnlyMember can still see storage + metrics (gpu.access) but not billing", () => {
    const ro = canFor("readOnlyMember");
    expect(isTabAllowed("storage", ro)).toBe(true);
    expect(isTabAllowed("metrics", ro)).toBe(true);
    expect(isTabAllowed("billing", ro)).toBe(false);
  });

  it("legacy baremetal tab is retired — never allowed (Spheron hidden)", () => {
    expect(isTabAllowed("baremetal", canFor("teamAdmin", true))).toBe(false);
    expect(isTabAllowed("baremetal", { "gpu.provision": true })).toBe(false);
    // Even with the entitlement context, the legacy tab stays hidden
    expect(isTabAllowed("baremetal", canFor("teamAdmin"), { bareMetalEnabled: true })).toBe(false);
  });

  it("bare-metal-orders requires BOTH billing.view and the bareMetalEnabled entitlement", () => {
    // billing.view alone is not enough — the per-account flag must be on
    expect(isTabAllowed("bare-metal-orders", { "billing.view": true })).toBe(false);
    expect(
      isTabAllowed("bare-metal-orders", { "billing.view": true }, { bareMetalEnabled: false }),
    ).toBe(false);
    // entitlement without billing.view is also not enough
    expect(
      isTabAllowed("bare-metal-orders", { "billing.view": false }, { bareMetalEnabled: true }),
    ).toBe(false);
    // both → allowed
    expect(
      isTabAllowed("bare-metal-orders", { "billing.view": true }, { bareMetalEnabled: true }),
    ).toBe(true);
    // first-paint (can-map not loaded) still must not redirect
    expect(isTabAllowed("bare-metal-orders", null, { bareMetalEnabled: true })).toBe(true);
  });

  it("every guarded tab has a predicate that denies an empty permission map", () => {
    for (const tab of Object.keys(TAB_VIEW_GUARDS)) {
      expect(isTabAllowed(tab as never, {})).toBe(false);
    }
  });
});
