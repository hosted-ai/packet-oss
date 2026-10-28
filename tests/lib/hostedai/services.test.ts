/**
 * getExposedServices response-shape tests.
 *
 * The platform answers GET /instances/unified/{id}/exposed-services with
 * `{"services": [...], "networking": {...}}` — an object, not the bare array
 * the client used to assume. Returning that object made the caller's
 * `.map(...)` throw, the route answer 500, and the dashboard's exposed-services
 * list stay empty however many services the instance actually had.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { exposeService, getExposedServices } from "@/lib/hostedai/services";
import { hostedaiRequest } from "@/lib/hostedai/client";

vi.mock("@/lib/hostedai/client", () => ({
  hostedaiRequest: vi.fn(),
}));

const row = {
  id: 21,
  service_name: "pa1951-probe",
  ip: "",
  internal_port: 8000,
  external_port: null,
  protocol: "TCP",
  type: "http",
  status: "EXPOSING",
  created_at: "2026-09-17T15:28:31.328Z",
};

describe("getExposedServices", () => {
  beforeEach(() => {
    vi.mocked(hostedaiRequest).mockReset();
  });

  it("reads the rows out of the platform's envelope", async () => {
    vi.mocked(hostedaiRequest).mockResolvedValue({
      services: [row],
      networking: {},
    });

    await expect(getExposedServices("i-abc")).resolves.toEqual([row]);
  });

  it("treats an envelope with no rows as no services", async () => {
    vi.mocked(hostedaiRequest).mockResolvedValue({
      services: null,
      networking: {},
    });

    await expect(getExposedServices("i-abc")).resolves.toEqual([]);
  });

  it("still reads a bare array", async () => {
    vi.mocked(hostedaiRequest).mockResolvedValue([row]);

    await expect(getExposedServices("i-abc")).resolves.toEqual([row]);
  });

  // A null body, and the `{}` an empty one is coerced to by the client.
  it.each([null, undefined, {}, "", { success: true }])(
    "answers [] for %o",
    async (body) => {
      vi.mocked(hostedaiRequest).mockResolvedValue(body);

      await expect(getExposedServices("i-abc")).resolves.toEqual([]);
    }
  );
});

const exposeOpts = {
  pod_name: "gpu-worker-7",
  port: 8888,
  service_name: "jupyter",
  protocol: "TCP",
  service_type: "http",
} as const;

// HAI resolves a unified instance from `pod_name` and rejects a non-numeric
// `pool_subscription_id`, so the caller's raw id has to be narrowed before the POST.
describe("exposeService", () => {
  beforeEach(() => {
    vi.mocked(hostedaiRequest).mockReset();
    vi.mocked(hostedaiRequest).mockResolvedValue({ id: 1 });
  });

  it("sends a unified instance id as the pod name and no subscription id", async () => {
    await exposeService({ ...exposeOpts, pool_subscription_id: "i-e18b434c-e0e8" });

    expect(hostedaiRequest).toHaveBeenCalledWith("POST", "/pods/expose-service", {
      ...exposeOpts,
      pod_name: "i-e18b434c-e0e8",
    });
  });

  it("keeps a legacy pool subscription id, as a number", async () => {
    await exposeService({ ...exposeOpts, pool_subscription_id: "412" });

    expect(hostedaiRequest).toHaveBeenCalledWith("POST", "/pods/expose-service", {
      ...exposeOpts,
      pool_subscription_id: 412,
    });
  });

  it.each([undefined, null, "", 0, NaN])(
    "omits the subscription id for %o rather than sending an unusable one",
    async (subscriptionId) => {
      await exposeService({ ...exposeOpts, pool_subscription_id: subscriptionId });

      expect(hostedaiRequest).toHaveBeenCalledWith(
        "POST",
        "/pods/expose-service",
        exposeOpts,
      );
    },
  );
});
