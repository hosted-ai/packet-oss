/**
 * PA-627 — POST /api/services regression tests.
 *
 * Bug: picking "Raw TCP (no prefix)" always failed. The route normalized that
 * choice to a `service_type` of "NodePort", but HAI's `PodExposedServiceType`
 * enum only defines http/https/none — HAI rejected it with a 400, and the
 * catch block flattened every non-409 error (including that 400) into an
 * opaque 500. Fix: normalize to the real "none" value, and map HAI's actual
 * upstream status through instead of masking it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/gate", () => ({
  gatePermission: vi.fn(),
}));

vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: vi.fn(),
}));

vi.mock("@/lib/hostedai", () => ({
  exposeService: vi.fn(),
  updateExposedService: vi.fn(),
  deleteExposedService: vi.fn(),
  getExposedServices: vi.fn(),
  getConnectionInfo: vi.fn(),
}));

vi.mock("@/lib/hostedai/client", () => ({
  clearCache: vi.fn(),
}));

import { POST } from "@/app/api/services/route";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { exposeService } from "@/lib/hostedai";

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/services", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const basePayload = {
  pod_name: "pod-1",
  pool_subscription_id: "i-abc123",
  port: 8080,
  service_name: "raw-tcp",
  protocol: "TCP",
};

describe("POST /api/services — PA-627", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyCustomerToken).mockReturnValue({
      customerId: "cus_test",
      email: "cust@example.com",
    } as never);
    vi.mocked(resolveOperatingContext).mockResolvedValue({
      accountId: "cus_test",
      customer: { id: "cus_test", email: "cust@example.com" },
    } as never);
    vi.mocked(gatePermission).mockResolvedValue(null);
  });

  it("forwards TCP + 'none' as-is instead of coercing it to http", async () => {
    vi.mocked(exposeService).mockResolvedValue({ id: 1 } as never);

    await POST(postReq({ ...basePayload, service_type: "none" }));

    expect(exposeService).toHaveBeenCalledWith(
      expect.objectContaining({ service_type: "none" }),
    );
  });

  it("maps a real upstream 400 through instead of masking it as a 500", async () => {
    vi.mocked(exposeService).mockRejectedValueOnce(
      new Error("Hosted.ai API error (400): Provided service type is invalid"),
    );

    const res = await POST(postReq({ ...basePayload, service_type: "none" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Provided service type is invalid");
  });

  it("still returns the friendly 409 for a duplicate service name", async () => {
    vi.mocked(exposeService).mockRejectedValueOnce(
      new Error("service name already exists"),
    );

    const res = await POST(postReq({ ...basePayload, service_type: "http" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("SERVICE_EXISTS");
  });
});
