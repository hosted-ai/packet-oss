import { describe, it, expect, vi } from "vitest";
import {
  can,
  ROLE_PERMISSIONS,
  PACKET_ROLES,
  PERMISSIONS,
  getHaiRoleForPacketRole,
  type Permission,
} from "@/lib/auth/role-permissions";
import { getHaiRoleIdForPacketRole } from "@/lib/auth/hai-role-ids";

vi.mock("@/lib/hostedai/default-roles", () => ({
  ensureRoles: vi.fn(async () => ({
    teamAdmin: "test-team-admin-uuid",
    teamMember: "test-team-member-uuid",
    readOnlyMember: "test-read-only-member-uuid",
    financeManager: "test-finance-manager-uuid",
  })),
}));

describe("can()", () => {
  describe("Owner short-circuit", () => {
    it("Owner allows for every permission regardless of role", () => {
      for (const perm of PERMISSIONS) {
        expect(can(null, true, perm)).toBe(true);
        expect(can(undefined, true, perm)).toBe(true);
        for (const role of PACKET_ROLES) {
          expect(can(role, true, perm)).toBe(true);
        }
      }
    });
  });

  describe("non-Owner with no role", () => {
    it("denies all permissions when role is null", () => {
      for (const perm of PERMISSIONS) {
        expect(can(null, false, perm)).toBe(false);
      }
    });

    it("denies all permissions when role is undefined", () => {
      for (const perm of PERMISSIONS) {
        expect(can(undefined, false, perm)).toBe(false);
      }
    });
  });

  describe("teamAdmin role (PA-201: full access including billing.manage)", () => {
    const cases: [Permission, boolean][] = [
      ["gpu.provision", true],
      ["gpu.terminate", true],
      ["gpu.access", true],
      ["billing.view", true],
      ["billing.manage", true],
      ["team.invite", true],
      ["team.manage", true],
      ["api_keys.create", true],
      ["api_keys.revoke", true],
      ["ssh_keys.manage", true],
      // PA-202 modules
      ["token_factory.use", true],
      ["huggingface.use", true],
      ["apps.use", true],
      ["referral.view", true],
      ["storage.manage", true],
      ["snapshots.manage", true],
    ];

    it.each(cases)("teamAdmin can do %s -> %s", (perm, expected) => {
      expect(can("teamAdmin", false, perm)).toBe(expected);
    });
  });

  describe("member role (PA-201: Team Member — infra + modules, no billing/team/referral)", () => {
    const cases: [Permission, boolean][] = [
      ["gpu.provision", true],
      ["gpu.terminate", true],
      ["gpu.access", true],
      ["billing.view", false],
      ["billing.manage", false],
      ["team.invite", false],
      ["team.manage", false],
      ["api_keys.create", true],
      ["api_keys.revoke", true],
      ["ssh_keys.manage", true],
      // PA-202 modules: member gets all except referral
      ["token_factory.use", true],
      ["huggingface.use", true],
      ["apps.use", true],
      ["referral.view", false], // PA-201 marks referral as Team Admin only
      ["storage.manage", true],
      ["snapshots.manage", true],
    ];

    it.each(cases)("member can do %s -> %s", (perm, expected) => {
      expect(can("member", false, perm)).toBe(expected);
    });
  });

  describe("readOnlyMember role (PA-202: SSH-only, all modules hidden)", () => {
    it("can SSH into existing pods", () => {
      expect(can("readOnlyMember", false, "gpu.access")).toBe(true);
      expect(can("readOnlyMember", false, "ssh_keys.manage")).toBe(true);
    });

    it("cannot provision, terminate, or manage anything", () => {
      expect(can("readOnlyMember", false, "gpu.provision")).toBe(false);
      expect(can("readOnlyMember", false, "gpu.terminate")).toBe(false);
      expect(can("readOnlyMember", false, "billing.view")).toBe(false);
      expect(can("readOnlyMember", false, "billing.manage")).toBe(false);
      expect(can("readOnlyMember", false, "team.invite")).toBe(false);
      expect(can("readOnlyMember", false, "team.manage")).toBe(false);
      expect(can("readOnlyMember", false, "api_keys.create")).toBe(false);
      expect(can("readOnlyMember", false, "api_keys.revoke")).toBe(false);
    });

    it("cannot access any of the PA-202 modules", () => {
      expect(can("readOnlyMember", false, "token_factory.use")).toBe(false);
      expect(can("readOnlyMember", false, "huggingface.use")).toBe(false);
      expect(can("readOnlyMember", false, "apps.use")).toBe(false);
      expect(can("readOnlyMember", false, "referral.view")).toBe(false);
      expect(can("readOnlyMember", false, "storage.manage")).toBe(false);
      expect(can("readOnlyMember", false, "snapshots.manage")).toBe(false);
    });
  });

  describe("financeManager role (PA-202: billing-only, instance read-only, no SSH/modules)", () => {
    it("manages billing and wallet", () => {
      expect(can("financeManager", false, "billing.view")).toBe(true);
      expect(can("financeManager", false, "billing.manage")).toBe(true);
    });

    it("has no GPU access at all", () => {
      expect(can("financeManager", false, "gpu.access")).toBe(false);
      expect(can("financeManager", false, "gpu.provision")).toBe(false);
      expect(can("financeManager", false, "gpu.terminate")).toBe(false);
      expect(can("financeManager", false, "ssh_keys.manage")).toBe(false);
    });

    it("cannot manage team", () => {
      expect(can("financeManager", false, "team.invite")).toBe(false);
      expect(can("financeManager", false, "team.manage")).toBe(false);
    });

    it("cannot access any of the PA-202 modules", () => {
      expect(can("financeManager", false, "token_factory.use")).toBe(false);
      expect(can("financeManager", false, "huggingface.use")).toBe(false);
      expect(can("financeManager", false, "apps.use")).toBe(false);
      expect(can("financeManager", false, "referral.view")).toBe(false);
      expect(can("financeManager", false, "storage.manage")).toBe(false);
      expect(can("financeManager", false, "snapshots.manage")).toBe(false);
    });
  });
});

describe("getHaiRoleForPacketRole()", () => {
  it("Owner always maps to teamAdmin regardless of role", () => {
    for (const role of PACKET_ROLES) {
      expect(getHaiRoleForPacketRole(role, true)).toBe("teamAdmin");
    }
  });

  it("teamAdmin maps to teamAdmin", () => {
    expect(getHaiRoleForPacketRole("teamAdmin", false)).toBe("teamAdmin");
  });

  it("each Packet role maps 1:1 to its HAI slug (HAI ships all four)", () => {
    expect(getHaiRoleForPacketRole("member", false)).toBe("teamMember");
    expect(getHaiRoleForPacketRole("readOnlyMember", false)).toBe(
      "readOnlyMember",
    );
    expect(getHaiRoleForPacketRole("financeManager", false)).toBe(
      "financeManager",
    );
  });
});

describe("getHaiRoleIdForPacketRole()", () => {
  it("returns HAI UUID for Owner via teamAdmin", async () => {
    const id = await getHaiRoleIdForPacketRole("member", true);
    expect(id).toBe("test-team-admin-uuid");
  });

  it("returns teamAdmin UUID for teamAdmin", async () => {
    const id = await getHaiRoleIdForPacketRole("teamAdmin", false);
    expect(id).toBe("test-team-admin-uuid");
  });

  it("returns the distinct HAI UUID for each non-Owner Packet role", async () => {
    expect(await getHaiRoleIdForPacketRole("member", false)).toBe(
      "test-team-member-uuid",
    );
    expect(await getHaiRoleIdForPacketRole("readOnlyMember", false)).toBe(
      "test-read-only-member-uuid",
    );
    expect(await getHaiRoleIdForPacketRole("financeManager", false)).toBe(
      "test-finance-manager-uuid",
    );
  });
});

describe("ROLE_PERMISSIONS structure", () => {
  it("has an entry for every PacketRole", () => {
    for (const role of PACKET_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_PERMISSIONS[role].slug).toBe(role);
      expect(ROLE_PERMISSIONS[role].displayName).toBeTruthy();
      expect(ROLE_PERMISSIONS[role].summary).toBeTruthy();
    }
  });

  it("all permissions in ROLE_PERMISSIONS are valid PERMISSIONS", () => {
    for (const role of PACKET_ROLES) {
      for (const perm of ROLE_PERMISSIONS[role].permissions) {
        expect(PERMISSIONS).toContain(perm);
      }
    }
  });

  it("display names are non-empty and distinct", () => {
    const names = PACKET_ROLES.map((r) => ROLE_PERMISSIONS[r].displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does NOT include team.transfer_ownership (PA-201: no transfer mechanic)", () => {
    expect((PERMISSIONS as readonly string[])).not.toContain("team.transfer_ownership");
  });
});
