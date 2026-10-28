// Tests for src/app/api/admin/broadcast/route.ts (GET, POST).
//
// PA-287 — admin email-broadcast coverage. Admin-cookie gated.
//   GET  — lists emailBroadcast rows (createdAt desc).
//   POST — action-dispatched:
//          "preview"   → resolveRecipients(segmentType) → { count, sampleEmails }
//          "send-test" → sendEmailDirect once to testEmail
//          "send"      → resolve recipients, create the broadcast record, return
//                        it immediately, and fire-and-forget the per-recipient
//                        send loop (sendEmailDirect + progress update + delay).
//          unknown / missing fields → 400.
//
// Mocked at the @/lib + fs + path boundary. verifySessionToken is sync.
// sendEmailDirect and delay are mockResolvedValue so the detached send loop does
// not actually wait; the loop's eventual effects are asserted via vi.waitFor.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockBroadcastFindMany,
  mockBroadcastCreate,
  mockBroadcastUpdate,
  mockCustomerFindMany,
  mockProviderNodeFindMany,
  mockSendEmailDirect,
  mockEmailLayout,
  mockDelay,
  mockReadPoolOverviewCache,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockBroadcastFindMany: vi.fn(),
  mockBroadcastCreate: vi.fn(),
  mockBroadcastUpdate: vi.fn(),
  mockCustomerFindMany: vi.fn(),
  mockProviderNodeFindMany: vi.fn(),
  mockSendEmailDirect: vi.fn(),
  mockEmailLayout: vi.fn(),
  mockDelay: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailBroadcast: {
      findMany: mockBroadcastFindMany,
      create: mockBroadcastCreate,
      update: mockBroadcastUpdate,
    },
    customerCache: { findMany: mockCustomerFindMany },
    providerNode: { findMany: mockProviderNodeFindMany },
  },
}));
vi.mock("@/lib/email/client", () => ({ sendEmailDirect: mockSendEmailDirect }));
vi.mock("@/lib/email/utils", () => ({ emailLayout: mockEmailLayout, delay: mockDelay }));
vi.mock("@/lib/pool-overview", () => ({ readPoolOverviewCache: mockReadPoolOverviewCache }));
// File-based logging — keep it inert so tests never touch the filesystem.
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
    renameSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
}));
vi.mock("path", () => ({
  default: { join: (...parts: string[]) => parts.join("/") },
}));

import { GET, POST } from "@/app/api/admin/broadcast/route";

const ADMIN_EMAIL = "admin@example.com";
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
  return new NextRequest("http://localhost/api/admin/broadcast", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockBroadcastFindMany.mockResolvedValue([{ id: "b1", subject: "Hello", status: "sent" }]);
  mockBroadcastCreate.mockResolvedValue({ id: "bc-1", subject: "Hi", status: "sending" });
  mockBroadcastUpdate.mockResolvedValue({});
  mockCustomerFindMany.mockResolvedValue([
    { email: "a@x.com", name: "A", isDeleted: false },
    { email: "b@x.com", name: "B", isDeleted: false },
  ]);
  mockProviderNodeFindMany.mockResolvedValue([]);
  mockSendEmailDirect.mockResolvedValue(undefined);
  mockEmailLayout.mockImplementation(({ body }: { body: string }) => `<layout>${body}</layout>`);
  mockDelay.mockResolvedValue(undefined);
  mockReadPoolOverviewCache.mockReturnValue(null);
});

describe("GET /api/admin/broadcast — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockBroadcastFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/broadcast", () => {
  it("lists broadcasts ordered by createdAt desc", async () => {
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(mockBroadcastFindMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" } });
  });

  it("returns 500 when the list query throws", async () => {
    mockBroadcastFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});

describe("POST /api/admin/broadcast — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makeReq("POST", { body: { action: "preview" }, withSession: false }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq("POST", { body: { action: "preview" } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unknown action", async () => {
    const res = await POST(makeReq("POST", { body: { action: "nope" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid action");
  });
});

describe("POST /api/admin/broadcast — preview", () => {
  it("resolves the recipient count and a sample for segment 'all'", async () => {
    const res = await POST(makeReq("POST", { body: { action: "preview", segmentType: "all" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.count).toBe(2);
    expect(body.data.sampleEmails).toEqual(["a@x.com", "b@x.com"]);
  });

  it("requires segmentType (400)", async () => {
    const res = await POST(makeReq("POST", { body: { action: "preview" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("segmentType is required");
  });

  it("dedupes recipients case-insensitively by email", async () => {
    mockCustomerFindMany.mockResolvedValue([
      { email: "Dup@X.com", name: "D1", isDeleted: false },
      { email: "dup@x.com", name: "D2", isDeleted: false },
    ]);
    const res = await POST(makeReq("POST", { body: { action: "preview", segmentType: "all" } }));
    const body = await res.json();
    expect(body.data.count).toBe(1);
    expect(body.data.sampleEmails).toEqual(["dup@x.com"]);
  });

  it("returns an empty custom segment when no emails are supplied", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "preview", segmentType: "custom", segmentFilter: {} } })
    );
    const body = await res.json();
    expect(body.data.count).toBe(0);
  });
});

describe("POST /api/admin/broadcast — send-test", () => {
  it("sends a single test email and returns success", async () => {
    const res = await POST(
      makeReq("POST", {
        body: {
          action: "send-test",
          subject: "Test",
          htmlBody: "Hello there",
          useLayout: true,
          testEmail: "qa@x.com",
        },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockSendEmailDirect).toHaveBeenCalledTimes(1);
    expect(mockSendEmailDirect).toHaveBeenCalledWith(
      expect.objectContaining({ to: "qa@x.com", subject: "Test" })
    );
    expect(mockEmailLayout).toHaveBeenCalled();
  });

  it("requires subject, htmlBody and testEmail (400)", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "send-test", subject: "Test" } })
    );
    expect(res.status).toBe(400);
    expect(mockSendEmailDirect).not.toHaveBeenCalled();
  });

  it("returns 500 when the test send fails", async () => {
    mockSendEmailDirect.mockRejectedValue(new Error("smtp boom"));
    const res = await POST(
      makeReq("POST", {
        body: { action: "send-test", subject: "T", htmlBody: "b", testEmail: "qa@x.com" },
      })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Email delivery failed");
  });
});

describe("POST /api/admin/broadcast — send", () => {
  it("requires subject, htmlBody and segmentType (400)", async () => {
    const res = await POST(makeReq("POST", { body: { action: "send", subject: "Hi" } }));
    expect(res.status).toBe(400);
    expect(mockBroadcastCreate).not.toHaveBeenCalled();
  });

  it("400s when no recipients match the segment", async () => {
    mockCustomerFindMany.mockResolvedValue([]);
    const res = await POST(
      makeReq("POST", {
        body: { action: "send", subject: "Hi", htmlBody: "Body", segmentType: "all" },
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No recipients");
    expect(mockBroadcastCreate).not.toHaveBeenCalled();
  });

  it("creates the broadcast record and returns it immediately", async () => {
    const res = await POST(
      makeReq("POST", {
        body: { action: "send", subject: "Hi", htmlBody: "Body", segmentType: "all" },
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("bc-1");
    const createArg = mockBroadcastCreate.mock.calls[0][0];
    expect(createArg.data.recipientCount).toBe(2);
    expect(createArg.data.status).toBe("sending");
    expect(createArg.data.createdBy).toBe(ADMIN_EMAIL);
  });

  it("fires the background send loop: one email per recipient", async () => {
    await POST(
      makeReq("POST", {
        body: { action: "send", subject: "Hi", htmlBody: "Body", segmentType: "all" },
      })
    );
    // The send loop is detached (fire-and-forget) → assert its eventual effects.
    await vi.waitFor(() => {
      expect(mockSendEmailDirect).toHaveBeenCalledTimes(2);
    });
    expect(mockSendEmailDirect).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@x.com" })
    );
    expect(mockSendEmailDirect).toHaveBeenCalledWith(
      expect.objectContaining({ to: "b@x.com" })
    );
  });
});
