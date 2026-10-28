/**
 * Tests for GET /api/admin/hai-services (src/app/api/admin/hai-services/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. Admin-cookie gated proxy that forwards
 * search/pagination params to the HAI `/service` listing endpoint via
 * hostedaiRequest and normalizes the response shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockHostedaiRequest } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockHostedaiRequest: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/hostedai", () => ({ hostedaiRequest: mockHostedaiRequest }));

import { GET } from "@/app/api/admin/hai-services/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/hai-services${query}`;
  return new NextRequest(url, { method: "GET", headers });
}

const SERVICE_ITEM = {
  id: "svc-1",
  name: "Jupyter",
  description: "notebook service",
  service_type: "container",
  is_enabled: true,
  is_system_defined: false,
  recipe_id: 7,
  recipe_exec_timing_type: "post",
  instances_count: 3,
};

/** Returns the endpoint string passed to hostedaiRequest. */
function calledEndpoint(): string {
  return mockHostedaiRequest.mock.calls[0]?.[1] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockHostedaiRequest.mockResolvedValue({ items: [SERVICE_ITEM], total: 1 });
});

describe("GET /api/admin/hai-services — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockHostedaiRequest).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockHostedaiRequest).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/hai-services — happy path & shaping", () => {
  it("maps HAI items to the normalized service shape", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.services).toEqual([
      {
        id: "svc-1",
        name: "Jupyter",
        description: "notebook service",
        serviceType: "container",
        isEnabled: true,
        isSystemDefined: false,
        recipeId: 7,
        recipeExecTimingType: "post",
        instancesCount: 3,
      },
    ]);
  });

  it("issues a GET to the /service endpoint with default pagination & sort", async () => {
    await GET(makeRequest());
    expect(mockHostedaiRequest).toHaveBeenCalledTimes(1);
    expect(mockHostedaiRequest.mock.calls[0][0]).toBe("GET");
    const endpoint = calledEndpoint();
    expect(endpoint).toContain("page=0");
    expect(endpoint).toContain("per_page=20");
    expect(endpoint).toContain("itemsPerPage=20");
    expect(endpoint).toContain("sort=name");
    expect(endpoint).toContain("order=asc");
    expect(endpoint).not.toContain("peqstr");
  });

  it("forwards search/page/per_page query params to HAI", async () => {
    await GET(makeRequest("?search=jup&page=2&per_page=50"));
    const endpoint = calledEndpoint();
    expect(endpoint).toContain("page=2");
    expect(endpoint).toContain("per_page=50");
    expect(endpoint).toContain("itemsPerPage=50");
    // search becomes the name[peqstr] filter (URL-encoded)
    expect(endpoint).toContain("name%5Bpeqstr%5D=jup");
  });
});

describe("GET /api/admin/hai-services — response variants", () => {
  it("handles a bare array response (no items wrapper) and derives total", async () => {
    mockHostedaiRequest.mockResolvedValue([SERVICE_ITEM, SERVICE_ITEM]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.services).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("returns an empty envelope when HAI yields no items", async () => {
    mockHostedaiRequest.mockResolvedValue({ items: [], total: 0 });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns 500 when the HAI request throws", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("hai down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to fetch services from HAI");
  });
});
