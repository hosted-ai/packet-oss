// Tests for src/app/api/admin/drip/route.ts (GET, POST).
//
// PA-287 — admin drip-campaign coverage. Admin-cookie gated.
//   GET  — lists dripSequences (with steps + _count.enrollments) and attaches
//          per-sequence active/completed/cancelled/total enrollment stats.
//   POST — action-dispatched: "seed" (creates the default free-signup sequence,
//          or no-ops if it already exists), "toggle" (flip active), "update-step"
//          (patch delayHours/active on a step), unknown action → 400.
//
// Mocked at the @/lib/prisma + @/lib/admin boundary. verifySessionToken is sync.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockSequenceFindMany,
  mockSequenceFindUnique,
  mockSequenceCreate,
  mockSequenceUpdate,
  mockStepUpdate,
  mockEnrollmentCount,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockSequenceFindMany: vi.fn(),
  mockSequenceFindUnique: vi.fn(),
  mockSequenceCreate: vi.fn(),
  mockSequenceUpdate: vi.fn(),
  mockStepUpdate: vi.fn(),
  mockEnrollmentCount: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dripSequence: {
      findMany: mockSequenceFindMany,
      findUnique: mockSequenceFindUnique,
      create: mockSequenceCreate,
      update: mockSequenceUpdate,
    },
    dripStep: { update: mockStepUpdate },
    dripEnrollment: { count: mockEnrollmentCount },
  },
}));

import { GET, POST } from "@/app/api/admin/drip/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest("http://localhost/api/admin/drip", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockSequenceFindMany.mockResolvedValue([
    { id: "seq-1", slug: "free-signup", name: "Free", steps: [], _count: { enrollments: 3 } },
  ]);
  // active, completed, cancelled (in that Promise.all order)
  mockEnrollmentCount
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(0);
  mockSequenceFindUnique.mockResolvedValue(null);
  mockSequenceCreate.mockResolvedValue({ id: "seq-new", slug: "free-signup", steps: [] });
  mockSequenceUpdate.mockResolvedValue({ id: "seq-1", active: false });
  mockStepUpdate.mockResolvedValue({ id: "step-1", delayHours: 12 });
});

describe("GET /api/admin/drip — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockSequenceFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
    expect(mockSequenceFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/drip", () => {
  it("returns sequences with attached enrollment stats", async () => {
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].stats).toEqual({
      sequenceId: "seq-1",
      active: 2,
      completed: 1,
      cancelled: 0,
      total: 3,
    });
  });

  it("returns an empty list when there are no sequences", async () => {
    mockSequenceFindMany.mockResolvedValue([]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(mockEnrollmentCount).not.toHaveBeenCalled();
  });

  it("returns 500 when the sequence query throws", async () => {
    mockSequenceFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to load drip sequences");
  });
});

describe("POST /api/admin/drip — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makeReq("POST", { body: { action: "seed" }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockSequenceCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq("POST", { body: { action: "seed" } }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/drip — seed", () => {
  it("defaults to the seed action and creates the free-signup sequence with 4 steps", async () => {
    const res = await POST(makeReq("POST", { body: {} }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Drip sequence created");
    const createArg = mockSequenceCreate.mock.calls[0][0];
    expect(createArg.data.slug).toBe("free-signup");
    expect(createArg.data.trigger).toBe("signup-free");
    expect(createArg.data.steps.create).toHaveLength(4);
  });

  it("no-ops when the free-signup sequence already exists", async () => {
    mockSequenceFindUnique.mockResolvedValue({ id: "seq-existing", slug: "free-signup" });
    const res = await POST(makeReq("POST", { body: { action: "seed" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe("Sequence already exists");
    expect(mockSequenceCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/drip — toggle", () => {
  it("flips the active flag on a sequence", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "toggle", sequenceId: "seq-1", active: false } })
    );
    expect(res.status).toBe(200);
    expect(mockSequenceUpdate).toHaveBeenCalledWith({
      where: { id: "seq-1" },
      data: { active: false },
    });
  });
});

describe("POST /api/admin/drip — update-step", () => {
  it("patches only the supplied step fields", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "update-step", stepId: "step-1", delayHours: 12 } })
    );
    expect(res.status).toBe(200);
    const updateArg = mockStepUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "step-1" });
    expect(updateArg.data).toEqual({ delayHours: 12 });
    expect(updateArg.data).not.toHaveProperty("active");
  });

  it("patches the active flag when supplied", async () => {
    await POST(
      makeReq("POST", { body: { action: "update-step", stepId: "step-1", active: false } })
    );
    const updateArg = mockStepUpdate.mock.calls[0][0];
    expect(updateArg.data).toEqual({ active: false });
  });
});

describe("POST /api/admin/drip — errors", () => {
  it("returns 400 for an unknown action", async () => {
    const res = await POST(makeReq("POST", { body: { action: "frobnicate" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown action");
  });

  it("returns 500 when a prisma write throws", async () => {
    mockSequenceFindUnique.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq("POST", { body: { action: "seed" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to process request");
  });
});
