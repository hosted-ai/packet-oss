// PA-298: GET /api/instances/connection-info?instance_id=... must not return
// SSH credentials for an instance the caller's teams don't own (IDOR).
// Reproducing test first: cross-team request must 404 and must NOT fetch creds.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const getUnifiedInstanceDetail = vi.fn();
const getInstanceCredentials = vi.fn();
const requirePermission = vi.fn(() => null); // allowed (gpu.access ✓)
let allTeamIds: string[] = ["team-A"];

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: vi.fn(async () => ({ payload: { email: "a@x.com" }, allTeamIds })),
}));
vi.mock("@/lib/auth/audit", () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...(args as [])),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { podMetadata: { findFirst: vi.fn(async () => null) } },
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));
vi.mock("@/lib/hostedai", () => ({
  getUnifiedInstanceDetail: (...a: unknown[]) => getUnifiedInstanceDetail(...(a as [])),
  getInstanceCredentials: (...a: unknown[]) => getInstanceCredentials(...(a as [])),
  getConnectionInfo: vi.fn(async () => []),
  getTeamInstances: vi.fn(async () => []),
}));

import { GET } from "@/app/api/instances/connection-info/route";

const call = (instanceId: string) =>
  GET(new NextRequest(`http://localhost/api/instances/connection-info?instance_id=${instanceId}`));

beforeEach(() => {
  vi.clearAllMocks();
  allTeamIds = ["team-A"];
  requirePermission.mockReturnValue(null);
});

describe("PA-298: connection-info instance_id ownership check", () => {
  it("returns 404 and does NOT fetch credentials for another team's instance", async () => {
    getUnifiedInstanceDetail.mockResolvedValue({ id: "i-bbb", team: { id: "team-B" } });
    getInstanceCredentials.mockResolvedValue({ ip: "9.9.9.9", port: 22, username: "root", password: "s3cret" });

    const res = (await call("i-bbb")) as NextResponse;
    expect(res.status).toBe(404);
    expect(getInstanceCredentials).not.toHaveBeenCalled();
  });

  it("returns 200 with credentials for the caller's own instance", async () => {
    getUnifiedInstanceDetail.mockResolvedValue({ id: "i-aaa", team: { id: "team-A" } });
    // no password → skips the internal-IP SSH enrichment (no child process spawned)
    getInstanceCredentials.mockResolvedValue({ ip: "1.2.3.4", port: 22, username: "root" });

    const res = (await call("i-aaa")) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instanceCredentials).toBeDefined();
    expect(getInstanceCredentials).toHaveBeenCalledWith("i-aaa");
  });

  it("returns 404 when the instance has no team (unattributable)", async () => {
    getUnifiedInstanceDetail.mockResolvedValue({ id: "i-ccc" });
    const res = (await call("i-ccc")) as NextResponse;
    expect(res.status).toBe(404);
    expect(getInstanceCredentials).not.toHaveBeenCalled();
  });
});
