// Tests for src/app/api/cron/check-hf-deployments/route.ts.
//
// Safety net for HuggingFace model deployments stuck in non-terminal states
// (e.g. server restarted mid-deploy). The cron SSHes into the pod, parses
// the install status, and finalizes the deployment row + notifies the
// customer. Pinned contracts:
//   * Auth gating
//   * Query scoping (stuck statuses, oldest first, capped per run)
//   * 2-hour timeout → auto-fail + failure email
//   * Skip ladder: deleted customer, missing team id, instance missing,
//     pod not running, creds not ready, SSH failure — all leave the row
//     untouched for the next run
//   * Terminal pod state → fail the deployment
//   * SSH says running → row updated, success email, activity logged
//   * Per-deployment error isolation; fatal error → 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockHfFindMany,
  mockHfUpdate,
  mockGetStripe,
  mockCustomersRetrieve,
  mockGetUnifiedInstances,
  mockGetExposedServices,
  mockExposeService,
  mockSendHfDeploymentEmail,
  mockGenerateCustomerToken,
  mockLogActivity,
  mockExecuteRemoteCommand,
  mockParseStatusOutput,
  mockGetSSHCredentials,
} = vi.hoisted(() => ({
  mockHfFindMany: vi.fn(),
  mockHfUpdate: vi.fn(),
  mockGetStripe: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockGetExposedServices: vi.fn(),
  mockExposeService: vi.fn(),
  mockSendHfDeploymentEmail: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockLogActivity: vi.fn(),
  mockExecuteRemoteCommand: vi.fn(),
  mockParseStatusOutput: vi.fn(),
  mockGetSSHCredentials: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    huggingFaceDeployment: { findMany: mockHfFindMany, update: mockHfUpdate },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai", () => ({
  getUnifiedInstances: mockGetUnifiedInstances,
}));
vi.mock("@/lib/hostedai/services", () => ({
  getExposedServices: mockGetExposedServices,
  exposeService: mockExposeService,
}));
vi.mock("@/lib/email", () => ({
  sendHfDeploymentEmail: mockSendHfDeploymentEmail,
}));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: mockGenerateCustomerToken,
  // PA-380: emailed sign-in links now mint via createLoginLink. Delegate to the
  // same spy so existing email/customerId + token assertions still hold.
  createLoginLink: vi.fn(async (o: { email: string; customerId: string }) =>
    mockGenerateCustomerToken(o.email, o.customerId),
  ),
}));
vi.mock("@/lib/activity", () => ({ logActivity: mockLogActivity }));
vi.mock("@/lib/huggingface-status", () => ({
  executeRemoteCommand: mockExecuteRemoteCommand,
  parseStatusOutput: mockParseStatusOutput,
  getSSHCredentials: mockGetSSHCredentials,
  ERROR_MESSAGES: {
    DEPLOYMENT_TIMEOUT: "Deployment timed out after 2 hours",
    OOM: "Model too large for GPU memory",
  },
  STATUS_CHECK_SCRIPT: "echo status",
}));

import { POST } from "@/app/api/cron/check-hf-deployments/route";

const SECRET = "cron-hf-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/check-hf-deployments", {
    method: "POST",
    headers,
  });
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "hf-1",
    hfItemName: "meta-llama/Llama-3-8B",
    stripeCustomerId: "cus_1",
    subscriptionId: "inst-1",
    createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
    ...overrides,
  };
}

describe("POST /api/cron/check-hf-deployments", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockGetStripe.mockResolvedValue({
      customers: { retrieve: mockCustomersRetrieve },
    });
    mockHfFindMany.mockResolvedValue([]);
    mockHfUpdate.mockResolvedValue({});
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_1",
      email: "user@x.com",
      name: "Ada",
      metadata: { hostedai_team_id: "team-1" },
    });
    mockGetUnifiedInstances.mockResolvedValue({
      items: [{ id: "inst-1", name: "pod-1", status: "running" }],
    });
    mockGetSSHCredentials.mockResolvedValue({
      host: "10.0.0.1",
      port: 22,
      username: "root",
      password: "pw",
    });
    mockExecuteRemoteCommand.mockResolvedValue({ success: true, output: "ok" });
    mockParseStatusOutput.mockReturnValue({ status: "installing" });
    mockGetExposedServices.mockResolvedValue([{ internal_port: 8000 }]);
    mockSendHfDeploymentEmail.mockResolvedValue(undefined);
    mockGenerateCustomerToken.mockReturnValue("tok_hf");
    mockLogActivity.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without querying", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockHfFindMany).not.toHaveBeenCalled();
  });

  it("queries stuck statuses oldest-first with a per-run cap", async () => {
    await POST(makeRequest(SECRET));

    expect(mockHfFindMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ["pending", "deploying", "installing", "starting", "downloading"],
        },
      },
      take: 10,
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns checked: 0 when nothing is stuck", async () => {
    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checked).toBe(0);
  });

  it("auto-fails deployments older than 2 hours and emails the customer", async () => {
    mockHfFindMany.mockResolvedValue([
      deployment({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }),
    ]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockHfUpdate).toHaveBeenCalledWith({
      where: { id: "hf-1" },
      data: {
        status: "failed",
        errorMessage: "Deployment timed out after 2 hours",
      },
    });
    expect(mockSendHfDeploymentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@x.com", status: "failed" }),
    );
    expect(body.results[0].action).toBe("timed_out");
    // Timeout path never needs the instance lookup
    expect(mockGetUnifiedInstances).not.toHaveBeenCalled();
  });

  it("skips (without touching the row) when prerequisites are missing", async () => {
    mockHfFindMany.mockResolvedValue([
      deployment({ id: "hf-no-team" }),
      deployment({ id: "hf-no-instance", subscriptionId: "inst-gone" }),
      deployment({ id: "hf-booting", subscriptionId: "inst-1" }),
    ]);
    mockCustomersRetrieve
      .mockResolvedValueOnce({ id: "cus_1", metadata: {} }) // no team id
      .mockResolvedValue({ id: "cus_1", metadata: { hostedai_team_id: "team-1" } });
    mockGetUnifiedInstances
      .mockResolvedValueOnce({ items: [] }) // instance not found
      .mockResolvedValueOnce({
        items: [{ id: "inst-1", status: "pending" }], // pod not running yet
      });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockHfUpdate).not.toHaveBeenCalled();
    expect(body.results.map((r: { action: string }) => r.action)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(body.results[0].error).toBe("no team ID");
    expect(body.results[1].error).toBe("instance not found");
    expect(body.results[2].error).toBe("pod not running");
  });

  it("fails the deployment when the pod reached a terminal state", async () => {
    mockHfFindMany.mockResolvedValue([deployment()]);
    mockGetUnifiedInstances.mockResolvedValue({
      items: [{ id: "inst-1", status: "CrashLoopBackOff" }],
    });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockHfUpdate).toHaveBeenCalledWith({
      where: { id: "hf-1" },
      data: {
        status: "failed",
        errorMessage: expect.stringContaining("Pod terminated unexpectedly"),
      },
    });
    expect(body.results[0].action).toBe("failed_pod_terminated");
  });

  it("skips when SSH credentials aren't ready or the SSH command fails", async () => {
    mockHfFindMany.mockResolvedValue([
      deployment({ id: "hf-no-creds" }),
      deployment({ id: "hf-ssh-fail" }),
    ]);
    mockGetSSHCredentials
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ host: "h", port: 22, username: "u", password: "p" });
    mockExecuteRemoteCommand.mockResolvedValue({ success: false, output: "" });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockHfUpdate).not.toHaveBeenCalled();
    expect(body.results[0].error).toBe("credentials not ready");
    expect(body.results[1].error).toBe("SSH failed");
  });

  it("marks the deployment running, sends the success email, and logs activity", async () => {
    mockHfFindMany.mockResolvedValue([deployment()]);
    mockParseStatusOutput.mockReturnValue({ status: "running" });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockHfUpdate).toHaveBeenCalledWith({
      where: { id: "hf-1" },
      data: { status: "running", errorMessage: null },
    });
    expect(mockSendHfDeploymentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", to: "user@x.com" }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      "cus_1",
      "hf_deployment_running",
      expect.stringContaining("meta-llama/Llama-3-8B"),
      { deploymentId: "hf-1" },
    );
    // Port 8000 already exposed in fixture → no duplicate expose call
    expect(mockExposeService).not.toHaveBeenCalled();
    expect(body.results[0].action).toBe("running");
  });

  it("exposes port 8000 when not already exposed", async () => {
    mockHfFindMany.mockResolvedValue([deployment()]);
    mockParseStatusOutput.mockReturnValue({ status: "running" });
    mockGetExposedServices.mockResolvedValue([]);

    await POST(makeRequest(SECRET));

    expect(mockExposeService).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8000, service_name: "vllm" }),
    );
  });

  it("maps SSH-reported failures through ERROR_MESSAGES", async () => {
    mockHfFindMany.mockResolvedValue([deployment()]);
    mockParseStatusOutput.mockReturnValue({ status: "failed", errorType: "OOM" });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockHfUpdate).toHaveBeenCalledWith({
      where: { id: "hf-1" },
      data: {
        status: "failed",
        errorMessage: "Model too large for GPU memory",
      },
    });
    expect(body.results[0].action).toBe("failed");
    expect(body.results[0].error).toBe("OOM");
  });

  it("isolates per-deployment errors and keeps checking the rest", async () => {
    mockHfFindMany.mockResolvedValue([
      deployment({ id: "hf-bad" }),
      deployment({ id: "hf-good" }),
    ]);
    mockCustomersRetrieve
      .mockRejectedValueOnce(new Error("stripe hiccup"))
      .mockResolvedValue({
        id: "cus_1",
        email: "user@x.com",
        metadata: { hostedai_team_id: "team-1" },
      });
    mockParseStatusOutput.mockReturnValue({ status: "running" });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      id: "hf-bad",
      action: "error",
      error: "stripe hiccup",
    });
    expect(body.results[1].action).toBe("running");
  });

  it("returns 500 when the deployment query fails", async () => {
    mockHfFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to check HF deployments");
  });
});
