import { describe, it, expect, vi, beforeEach } from "vitest";

// The deploy paths store `subscription_id` as an `instance-` placeholder and
// the HAI instance UUID in `instance_id`, so this stands in for that row.
const row = {
  subscriptionId: "instance-i-abc",
  instanceId: "i-abc",
  startupScriptStatus: null as string | null,
  startupScriptOutput: null as string | null,
};

const mockUpdate = vi.fn(
  async ({ where, data }: { where: Record<string, string>; data: Record<string, string> }) => {
    const found =
      (where.instanceId !== undefined && where.instanceId === row.instanceId) ||
      (where.subscriptionId !== undefined && where.subscriptionId === row.subscriptionId);
    if (!found) {
      const err = new Error(
        "An operation failed because it depends on one or more records that were required but not found. No record was found for an update.",
      );
      (err as Error & { code: string }).code = "P2025";
      throw err;
    }
    Object.assign(row, data);
    return { ...row };
  },
);

vi.mock("@/lib/prisma", () => ({
  prisma: { podMetadata: { update: (...args: unknown[]) => mockUpdate(...(args as [never])) } },
}));

// Parks the pod-readiness loop for good, so the test observes only the writes
// the runner makes before it.
const mockGetConnectionInfo = vi.fn(() => new Promise<never[]>(() => {}));
vi.mock("@/lib/hostedai", () => ({ getConnectionInfo: () => mockGetConnectionInfo() }));
vi.mock("@/lib/hostedai/services", () => ({ exposeService: vi.fn() }));
vi.mock("@/lib/startup-scripts", () => ({ getStartupScriptPreset: vi.fn() }));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));

import { runStartupScript } from "@/lib/startup-script-runner";

describe("runStartupScript metadata writes", () => {
  beforeEach(() => {
    row.startupScriptStatus = null;
    row.startupScriptOutput = null;
    mockUpdate.mockClear();
  });

  it("writes status against the instance the deploy just created", async () => {
    void runStartupScript("i-abc", "team-1", "echo hi");
    await new Promise((r) => setTimeout(r, 200));

    expect(mockUpdate).toHaveBeenCalled();
    for (const [call] of mockUpdate.mock.calls) {
      expect(call.where).toEqual({ instanceId: "i-abc" });
    }
    expect(row.startupScriptStatus).toBe("pending");
  });
});
