// Tests for getActivePodCountsByTeam() in src/lib/admin-cache.ts (PA-400).
//
// The admin Customers tab needs a live per-team active-GPU count instead of the
// 12h admin-stats snapshot. This helper does ONE global /instances/unified
// fetch and groups the active instances by team id. Pinned here: which statuses
// count as active (running/active/pending/starting/restarting — pods AND live
// VMs, matching the admin-stats counters post-PA-134), that non-active statuses
// and team-less instances are excluded, and that invalidateAdminCache() resets
// the module cache.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAllUnifiedInstances } = vi.hoisted(() => ({
  mockGetAllUnifiedInstances: vi.fn(),
}));

vi.mock("@/lib/hostedai", () => ({
  getAllUnifiedInstances: mockGetAllUnifiedInstances,
  getPoolSubscriptions: vi.fn(),
}));
vi.mock("@/lib/hostedai/policies", () => ({ getDefaultResourcePolicy: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { customerCache: { findMany: vi.fn() } },
}));

import { getActivePodCountsByTeam, invalidateAdminCache } from "@/lib/admin-cache";

function inst(status: string, teamId?: string) {
  return { id: `i-${status}-${teamId ?? "none"}`, status, team: teamId ? { id: teamId } : undefined };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAdminCache(); // reset the module-level 5-min cache between tests
});

describe("getActivePodCountsByTeam (PA-400)", () => {
  it("groups active instances by team id", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([
      inst("running", "team-1"),
      inst("running", "team-1"),
      inst("pending", "team-2"),
    ]);
    const counts = await getActivePodCountsByTeam();
    expect(counts.get("team-1")).toBe(2);
    expect(counts.get("team-2")).toBe(1);
  });

  it("counts a live VM instance reported as 'active' (matches PA-134)", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([
      inst("active", "team-1"), // VM live status
      inst("Running", "team-1"), // case-insensitive
      inst("STARTING", "team-1"),
      inst("restarting", "team-2"),
    ]);
    const counts = await getActivePodCountsByTeam();
    expect(counts.get("team-1")).toBe(3);
    expect(counts.get("team-2")).toBe(1);
  });

  it("excludes non-active statuses and team-less instances", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([
      inst("stopped", "team-1"),
      inst("error", "team-1"),
      inst("deleted", "team-1"),
      inst("succeeded", "team-1"), // billable but not "active/live"
      inst("running"), // no team → excluded
    ]);
    const counts = await getActivePodCountsByTeam();
    expect(counts.has("team-1")).toBe(false);
    expect(counts.size).toBe(0);
  });

  it("issues a single global fetch and caches within the TTL", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([inst("running", "team-1")]);
    await getActivePodCountsByTeam();
    await getActivePodCountsByTeam();
    expect(mockGetAllUnifiedInstances).toHaveBeenCalledTimes(1);
  });

  it("propagates a fetch failure so callers can fall back to the snapshot", async () => {
    mockGetAllUnifiedInstances.mockRejectedValue(new Error("HAI down"));
    await expect(getActivePodCountsByTeam()).rejects.toThrow("HAI down");
  });
});
