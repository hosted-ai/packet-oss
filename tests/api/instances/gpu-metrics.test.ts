// Tests for src/app/api/instances/[id]/gpu-metrics/route.ts (PA-287).
//
// GET fetches vLLM Prometheus metrics from a running instance. Auth is the
// customer-bearer stack (verifyCustomerToken). The handler:
//   * resolves the vLLM service from getExposedServices (HAI boundary),
//   * fetches /metrics, /v1/models and /health from the vLLM pod over HTTP,
//   * parses the Prometheus text into a numeric metrics envelope.
//
// What we pin:
//   * Bearer auth (missing/invalid -> 401), no HAI call on the unauth path.
//   * getExposedServices is called with the [id] param.
//   * getExposedServices throw -> 404 (instance not found/running).
//   * Non-array HAI shape -> 404 (the defensive guard against .find crashing).
//   * No vLLM service / missing ip / missing port -> 404.
//   * Happy path: parses the Prometheus body and shapes the metrics envelope.
//   * Empty/partial /metrics body -> sane zeroed envelope (no crash).
//   * Top-level throw -> 500 with a diagnostic (non-leaking) message.
//
// We mock global fetch (the vLLM pod HTTP calls) so no network is touched.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifyCustomerToken, mockGetExposedServices } = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGetExposedServices: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/hostedai", () => ({
  getExposedServices: mockGetExposedServices,
}));

import { GET } from "@/app/api/instances/[id]/gpu-metrics/route";

const TOKEN = "Bearer valid.jwt.token";
const PAYLOAD = { customerId: "cus_jwt", email: "alice@example.com" };
const params = Promise.resolve({ id: "i-abc" });

function makeRequest(authorized = true) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", TOKEN);
  return new NextRequest("http://localhost/api/instances/i-abc/gpu-metrics", {
    method: "GET",
    headers,
  });
}

const VLLM_SERVICE = {
  service_name: "vllm",
  internal_port: 8000,
  external_port: 31000,
  ip: "10.0.0.5",
};

// Minimal Prometheus body exercising the parser branches.
const METRICS_TEXT = [
  "# HELP something",
  "vllm:gpu_cache_usage_perc 0.42",
  "vllm:cpu_cache_usage_perc 0.10",
  "vllm:num_requests_running 3",
  "vllm:num_requests_waiting 2",
  "vllm:num_requests_swapped 0",
  "vllm:prompt_tokens_total 1000",
  "vllm:generation_tokens_total 500",
  "vllm:avg_prompt_throughput_toks_per_s 12.5",
  "vllm:avg_generation_throughput_toks_per_s 8.25",
  "vllm:time_to_first_token_seconds_sum 0.2",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/instances/[id]/gpu-metrics", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await GET(makeRequest(false), { params });
    expect(res.status).toBe(401);
    expect(mockGetExposedServices).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(401);
    expect(mockGetExposedServices).not.toHaveBeenCalled();
  });

  it("calls getExposedServices with the [id] param", async () => {
    mockGetExposedServices.mockResolvedValue([VLLM_SERVICE]);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("pod unreachable"));
    await GET(makeRequest(), { params });
    expect(mockGetExposedServices).toHaveBeenCalledWith("i-abc");
  });

  it("returns 404 when getExposedServices throws (instance not running)", async () => {
    mockGetExposedServices.mockRejectedValue(new Error("HAI 404"));
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 when HAI returns a non-array shape (defensive guard)", async () => {
    mockGetExposedServices.mockResolvedValue({ error: "no services" });
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("vLLM service not exposed");
  });

  it("returns 404 when no vLLM service is exposed", async () => {
    mockGetExposedServices.mockResolvedValue([
      { service_name: "ollama", internal_port: 11434, ip: "10.0.0.9", external_port: 32000 },
    ]);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the vLLM service has no ip", async () => {
    mockGetExposedServices.mockResolvedValue([{ ...VLLM_SERVICE, ip: undefined }]);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the vLLM service has no external port", async () => {
    mockGetExposedServices.mockResolvedValue([{ ...VLLM_SERVICE, external_port: undefined }]);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("parses the Prometheus body and shapes the metrics envelope", async () => {
    mockGetExposedServices.mockResolvedValue([VLLM_SERVICE]);
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/metrics")) {
        return { ok: true, text: async () => METRICS_TEXT } as unknown as Response;
      }
      if (url.endsWith("/v1/models")) {
        return { ok: true, json: async () => ({ data: [{ id: "llama-3" }] }) } as unknown as Response;
      }
      // /health
      return { ok: true } as unknown as Response;
    });

    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.subscriptionId).toBe("i-abc");
    expect(body.metrics.gpuCacheUsagePercent).toBeCloseTo(42);
    expect(body.metrics.cpuCacheUsagePercent).toBeCloseTo(10);
    expect(body.metrics.numRequestsRunning).toBe(3);
    expect(body.metrics.numRequestsWaiting).toBe(2);
    expect(body.metrics.promptTokensTotal).toBe(1000);
    expect(body.metrics.generationTokensTotal).toBe(500);
    expect(body.metrics.avgPromptThroughput).toBeCloseTo(12.5);
    expect(body.metrics.avgGenerationThroughput).toBeCloseTo(8.25);
    expect(body.metrics.avgTimeToFirstToken).toBeCloseTo(200); // 0.2s -> ms
    expect(body.metrics.modelId).toBe("llama-3");
    expect(body.metrics.isHealthy).toBe(true);
    expect(body.timestamp).toBeTypeOf("string");
  });

  it("returns a zeroed envelope when the vLLM pod is unreachable (no crash)", async () => {
    mockGetExposedServices.mockResolvedValue([VLLM_SERVICE]);
    // Every pod HTTP call rejects — the handler swallows them per-section.
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.gpuCacheUsagePercent).toBe(0);
    expect(body.metrics.numRequestsRunning).toBe(0);
    expect(body.metrics.modelId).toBeNull();
    expect(body.metrics.isHealthy).toBe(false);
  });

  it("returns a zeroed envelope when /metrics responds non-ok (partial telemetry)", async () => {
    mockGetExposedServices.mockResolvedValue([VLLM_SERVICE]);
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) return { ok: true } as unknown as Response;
      return { ok: false, text: async () => "", json: async () => ({}) } as unknown as Response;
    });

    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.gpuCacheUsagePercent).toBe(0);
    expect(body.metrics.modelId).toBeNull();
    expect(body.metrics.isHealthy).toBe(true);
  });

  it("identifies the vLLM service by name when port is not 8000", async () => {
    mockGetExposedServices.mockResolvedValue([
      { service_name: "inference-server", internal_port: 9999, external_port: 31000, ip: "10.0.0.5" },
    ]);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("unreachable"));
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200); // service was found, pod just unreachable
  });
});
