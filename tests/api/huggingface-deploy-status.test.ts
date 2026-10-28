// Tests for GET /api/huggingface/deploy-status (src/app/api/huggingface/deploy-status/route.ts).
//
// PA-320 coverage deepening. This is the HF deploy-status polling route:
// auth → huggingface.use gate → require subscriptionId + team → verify the
// instance belongs to the team (getUnifiedInstances) → branch on instance
// status (terminated → mark failed; not-running → not_started; no SSH creds
// → not_started) → SSH status probe + parse → shaped StatusResponse → on a
// final-state transition, update DB + send email.
//
// We mock every lib boundary and pin the status-code / envelope shape for the
// branches the (currently-zero) coverage misses.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockGetUnifiedInstances,
  mockHfFindFirst,
  mockHfUpdate,
  mockSendEmail,
  mockGenerateCustomerToken,
  mockLogActivity,
  mockGenerateDeployScript,
  mockGetDefaultPort,
  mockGetCatalogItem,
  mockExecuteRemoteCommand,
  mockExecuteRemoteScript,
  mockParseStatusOutput,
  mockGetSSHCredentials,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockHfFindFirst: vi.fn(),
  mockHfUpdate: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockLogActivity: vi.fn(),
  mockGenerateDeployScript: vi.fn(),
  mockGetDefaultPort: vi.fn(),
  mockGetCatalogItem: vi.fn(),
  mockExecuteRemoteCommand: vi.fn(),
  mockExecuteRemoteScript: vi.fn(),
  mockParseStatusOutput: vi.fn(),
  mockGetSSHCredentials: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({ getAuthenticatedCustomer: mockGetAuthenticatedCustomer }));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/hostedai", () => ({ getUnifiedInstances: mockGetUnifiedInstances }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    huggingFaceDeployment: { findFirst: mockHfFindFirst, update: mockHfUpdate },
  },
}));
vi.mock("@/lib/email", () => ({ sendHfDeploymentEmail: mockSendEmail }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: mockGenerateCustomerToken,
  // PA-380: emailed sign-in links now mint via createLoginLink. Delegate to the
  // same spy so existing email/customerId + token assertions still hold.
  createLoginLink: vi.fn(async (o: { email: string; customerId: string }) =>
    mockGenerateCustomerToken(o.email, o.customerId),
  ),
}));
vi.mock("@/lib/activity", () => ({ logActivity: mockLogActivity }));
vi.mock("@/lib/huggingface-deploy-scripts", () => ({
  generateDeployScript: mockGenerateDeployScript,
  getDefaultPort: mockGetDefaultPort,
}));
vi.mock("@/lib/huggingface-catalog", () => ({ getCatalogItem: mockGetCatalogItem }));
vi.mock("@/lib/huggingface-status", () => ({
  executeRemoteCommand: mockExecuteRemoteCommand,
  executeRemoteScript: mockExecuteRemoteScript,
  parseStatusOutput: mockParseStatusOutput,
  getSSHCredentials: mockGetSSHCredentials,
  ERROR_MESSAGES: { OOM: "Out of memory" },
  STATUS_CHECK_SCRIPT: "echo STATUS",
}));

import { GET } from "@/app/api/huggingface/deploy-status/route";

const AUTH = {
  payload: { customerId: "cus_1", email: "a@x.com" },
  customer: { id: "cus_1", email: "a@x.com", name: "Alice" },
  teamId: "team-1",
  accountId: "cus_1",
};

function makeReq(subscriptionId: string | null = "inst-1") {
  const q = subscriptionId == null ? "" : `?subscriptionId=${subscriptionId}`;
  return new NextRequest(`http://localhost/api/huggingface/deploy-status${q}`, {
    method: "GET",
    headers: new Headers({ authorization: "Bearer t" }),
  });
}

const RUNNING_INSTANCE = { id: "inst-1", name: "pod-one", status: "Running" };
const SSH_CREDS = { host: "1.2.3.4", port: 2222, username: "root", password: "pw" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH });
  mockRequirePermission.mockReturnValue(null);
  mockGetUnifiedInstances.mockResolvedValue({ items: [RUNNING_INSTANCE] });
  mockGetSSHCredentials.mockResolvedValue(SSH_CREDS);
  mockHfFindFirst.mockResolvedValue(null); // no pending deployment by default
  mockHfUpdate.mockResolvedValue({});
  mockGetDefaultPort.mockReturnValue(8000);
  // STATUS probe (the install.log "MISSING" probe) + the main status command.
  mockExecuteRemoteCommand.mockResolvedValue({ success: true, output: "---LOGS---\nready" });
  mockParseStatusOutput.mockReturnValue({ status: "installing", progressPercent: 30, errorType: undefined });
});

describe("GET /api/huggingface/deploy-status — auth & validation", () => {
  it("returns the auth response verbatim when unauthenticated", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(denied);
    const res = await GET(makeReq());
    expect(res).toBe(denied);
  });

  it("returns the permission denial verbatim (huggingface.use)", async () => {
    const denial = NextResponse.json({ error: "denied" }, { status: 403 });
    mockRequirePermission.mockReturnValue(denial);
    const res = await GET(makeReq());
    expect(res).toBe(denial);
    expect(mockGetUnifiedInstances).not.toHaveBeenCalled();
  });

  it("returns 400 when subscriptionId is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("subscriptionId is required");
  });

  it("returns 400 when the auth context has no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH, teamId: undefined });
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No team associated with this account");
  });
});

describe("GET /api/huggingface/deploy-status — instance lookup branches", () => {
  it("returns 404 when the instance is not in the team's unified list", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "other", status: "Running" }] });
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Instance not found");
  });

  it("marks a terminated instance failed and returns a POD_TERMINATED envelope", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "inst-1", name: "p", status: "error" }] });
    mockHfFindFirst.mockResolvedValue({ id: "dep-1", status: "deploying", hfItemName: "Y" });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.error).toBe("POD_TERMINATED");
    expect(mockHfUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "dep-1" }, data: expect.objectContaining({ status: "failed" }) })
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      "cus_1",
      "hf_deployment_pod_terminated",
      expect.any(String),
      expect.objectContaining({ deploymentId: "dep-1" })
    );
  });

  it("does NOT re-update a deployment already marked failed on a terminated instance", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "inst-1", name: "p", status: "terminated" }] });
    mockHfFindFirst.mockResolvedValue({ id: "dep-1", status: "failed", hfItemName: "Y" });
    const res = await GET(makeReq());
    expect((await res.json()).error).toBe("POD_TERMINATED");
    expect(mockHfUpdate).not.toHaveBeenCalled();
  });

  it("returns not_started when the instance is not running yet", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "inst-1", name: "p", status: "Pending" }] });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("not_started");
    expect(body.message).toContain("Pending");
  });

  it("returns not_started when SSH credentials are not yet available", async () => {
    mockGetSSHCredentials.mockResolvedValue(null);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.status).toBe("not_started");
    expect(body.message).toContain("waiting for SSH");
  });
});

describe("GET /api/huggingface/deploy-status — deploy trigger probe", () => {
  it("fires the deploy script when a pending deployment has no install.log yet", async () => {
    mockHfFindFirst.mockResolvedValue({
      id: "dep-1", hfItemId: "x/y", hfItemType: "model", hfItemName: "Y",
      deployScript: "tgi", servicePort: 8000, hfToken: null, openWebUI: false, netdata: false,
      status: "pending", createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    // First call = probe (MISSING), second call = status command.
    mockExecuteRemoteCommand
      .mockResolvedValueOnce({ success: true, output: "MISSING" })
      .mockResolvedValueOnce({ success: true, output: "---LOGS---\nlog" });
    mockGenerateDeployScript.mockReturnValue("#!/bin/bash echo deploy");
    mockExecuteRemoteScript.mockResolvedValue({ success: true, output: "ok", exitCode: 0 });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    // The probe must have been issued with the install.log test command.
    expect(mockExecuteRemoteCommand.mock.calls[0][4]).toContain("install.log");
  });

  it("does NOT fire the deploy script when install.log already EXISTS", async () => {
    mockHfFindFirst.mockResolvedValue({
      id: "dep-1", hfItemId: "x/y", hfItemType: "model", hfItemName: "Y",
      deployScript: "tgi", servicePort: 8000, hfToken: null, openWebUI: false, netdata: false,
      status: "pending", createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    mockExecuteRemoteCommand
      .mockResolvedValueOnce({ success: true, output: "EXISTS" })
      .mockResolvedValueOnce({ success: true, output: "---LOGS---\nlog" });

    await GET(makeReq());
    expect(mockGenerateDeployScript).not.toHaveBeenCalled();
  });
});

describe("GET /api/huggingface/deploy-status — status shaping & DB updates", () => {
  it("returns not_started when the SSH status command fails", async () => {
    mockExecuteRemoteCommand.mockResolvedValue({ success: false, output: "ssh refused" });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.status).toBe("not_started");
    expect(body.message).toContain("Connecting to GPU");
  });

  it("shapes a running status with apiEndpoint + advanced view", async () => {
    mockParseStatusOutput.mockReturnValue({ status: "running", progressPercent: 100, errorType: undefined });
    mockHfFindFirst.mockResolvedValue({
      id: "dep-1", status: "starting", hfItemName: "Y", hfItemId: "x/y",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.status).toBe("running");
    expect(body.apiEndpoint).toBe("http://localhost:8000/v1");
    expect(body.advanced.podName).toBe("pod-one");
    expect(body.advanced.sshCommand).toBe("ssh root@1.2.3.4 -p 2222");
  });

  it("updates the deployment to running and emails on the starting→running transition", async () => {
    mockParseStatusOutput.mockReturnValue({ status: "running", progressPercent: 100, errorType: undefined });
    mockHfFindFirst.mockResolvedValue({
      id: "dep-1", status: "starting", hfItemName: "Y", hfItemId: "x/y",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    mockGenerateCustomerToken.mockReturnValue("tok");
    mockSendEmail.mockResolvedValue(undefined);

    await GET(makeReq());
    expect(mockHfUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "dep-1" }, data: expect.objectContaining({ status: "running" }) })
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@x.com", status: "success" })
    );
  });

  it("uses the ERROR_MESSAGES mapping when a failed status carries an errorType", async () => {
    mockParseStatusOutput.mockReturnValue({ status: "failed", progressPercent: 0, errorType: "OOM" });
    mockHfFindFirst.mockResolvedValue({
      id: "dep-1", status: "starting", hfItemName: "Y", hfItemId: "x/y",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.message).toBe("Out of memory");
  });

  it("does NOT email when the deployment status is unchanged", async () => {
    mockParseStatusOutput.mockReturnValue({ status: "running", progressPercent: 100, errorType: undefined });
    mockHfFindFirst.mockResolvedValue({
      id: "dep-1", status: "running", hfItemName: "Y", hfItemId: "x/y",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    await GET(makeReq());
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 500 when getUnifiedInstances throws", async () => {
    mockGetUnifiedInstances.mockRejectedValue(new Error("hai down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get deployment status");
  });
});
