// Tests for src/app/api/cron/process-drip/route.ts.
//
// Hourly drip-campaign processor. The revenue-relevant invariants:
//   * The $25 welcome credit fires on the FIRST step only, and is idempotent
//     against Stripe balance-transaction metadata (type=drip_credit)
//   * Converted customers (billing_type beyond free/free_trial) get their
//     enrollment cancelled, never another email
//   * Enrollment only advances after a successful send — a failed send
//     leaves currentStep untouched so the next run retries
//   * Product vertical (GPU vs API) selects the template family
//   * Step timing respects delayHours from lastSentAt (or enrolledAt)
//
// NOTE: this route hand-rolls its auth check (`Bearer ${CRON_SECRET}`)
// instead of using fail-closed verifyCronAuth — tests set CRON_SECRET so the
// distinction is invisible here, but it's flagged in the route review.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockEnrollmentFindMany,
  mockEnrollmentUpdate,
  mockGetStripe,
  mockCustomersRetrieve,
  mockListBalanceTransactions,
  mockCreateBalanceTransaction,
  mockCacheCustomer,
  mockGenerateCustomerToken,
  mockGenerateUnsubscribeToken,
  mockResolvePrimaryCustomer,
  mockSendDripGpu1,
  mockSendDripGpu2,
  mockSendDripGpu3,
  mockSendDripApi1,
  mockSendDripApi2,
  mockSendDripApi3,
  mockSendDripDay1,
} = vi.hoisted(() => ({
  mockEnrollmentFindMany: vi.fn(),
  mockEnrollmentUpdate: vi.fn(),
  mockGetStripe: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockListBalanceTransactions: vi.fn(),
  mockCreateBalanceTransaction: vi.fn(),
  mockCacheCustomer: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockGenerateUnsubscribeToken: vi.fn(),
  mockResolvePrimaryCustomer: vi.fn(),
  mockSendDripGpu1: vi.fn(),
  mockSendDripGpu2: vi.fn(),
  mockSendDripGpu3: vi.fn(),
  mockSendDripApi1: vi.fn(),
  mockSendDripApi2: vi.fn(),
  mockSendDripApi3: vi.fn(),
  mockSendDripDay1: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dripEnrollment: {
      findMany: mockEnrollmentFindMany,
      update: mockEnrollmentUpdate,
    },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: mockGenerateCustomerToken,
  // PA-380: emailed sign-in links now mint via createLoginLink. Delegate to the
  // same spy so existing email/customerId + token assertions still hold.
  createLoginLink: vi.fn(async (o: { email: string; customerId: string }) =>
    mockGenerateCustomerToken(o.email, o.customerId),
  ),
  generateUnsubscribeToken: mockGenerateUnsubscribeToken,
}));
vi.mock("@/lib/customer-resolver", () => ({
  resolvePrimaryCustomer: mockResolvePrimaryCustomer,
}));
vi.mock("@/lib/email/templates/drip", () => ({
  sendDripGpu1: mockSendDripGpu1,
  sendDripGpu2: mockSendDripGpu2,
  sendDripGpu3: mockSendDripGpu3,
  sendDripApi1: mockSendDripApi1,
  sendDripApi2: mockSendDripApi2,
  sendDripApi3: mockSendDripApi3,
  sendDripDay1: mockSendDripDay1,
  sendDripDay3: vi.fn(),
  sendDripDay7: vi.fn(),
  sendDripDay14: vi.fn(),
}));

import { POST } from "@/app/api/cron/process-drip/route";

const SECRET = "cron-drip-secret";
const ORIGINAL = process.env.CRON_SECRET;
const HOUR_MS = 60 * 60 * 1000;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  return new NextRequest("http://localhost/api/cron/process-drip", {
    method: "POST",
    headers,
  });
}

function steps(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    stepOrder: i,
    delayHours: i === 0 ? 0 : 24,
    templateSlug: `drip-step-${i}`,
    active: true,
  }));
}

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: "enr-1",
    status: "active",
    currentStep: 0,
    enrolledAt: new Date(Date.now() - 48 * HOUR_MS),
    lastSentAt: null,
    email: "user@x.com",
    customerName: "Ada",
    stripeCustomerId: "cus_1",
    metadata: null,
    sequence: { active: true, steps: steps() },
    ...overrides,
  };
}

describe("POST /api/cron/process-drip", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockGetStripe.mockResolvedValue({
      customers: {
        retrieve: mockCustomersRetrieve,
        listBalanceTransactions: mockListBalanceTransactions,
        createBalanceTransaction: mockCreateBalanceTransaction,
      },
    });
    mockEnrollmentFindMany.mockResolvedValue([]);
    mockEnrollmentUpdate.mockResolvedValue({});
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_1",
      metadata: { billing_type: "free" },
    });
    mockListBalanceTransactions.mockResolvedValue({ data: [] });
    mockCreateBalanceTransaction.mockResolvedValue({});
    mockCacheCustomer.mockResolvedValue(undefined);
    mockGenerateCustomerToken.mockReturnValue("tok_drip");
    mockGenerateUnsubscribeToken.mockReturnValue("tok_unsub");
    mockResolvePrimaryCustomer.mockResolvedValue(null);
    for (const sender of [
      mockSendDripGpu1, mockSendDripGpu2, mockSendDripGpu3,
      mockSendDripApi1, mockSendDripApi2, mockSendDripApi3,
    ]) {
      sender.mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 without the bearer secret", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockEnrollmentFindMany).not.toHaveBeenCalled();
  });

  it("handles zero active enrollments", async () => {
    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, processed: 0, sent: 0 });
  });

  it("skips enrollments whose next step isn't due yet", async () => {
    mockEnrollmentFindMany.mockResolvedValue([
      enrollment({
        currentStep: 1,
        lastSentAt: new Date(Date.now() - 2 * HOUR_MS), // step 1 needs 24h
      }),
    ]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it("sends the first GPU email with the $25 credit and advances the enrollment", async () => {
    mockEnrollmentFindMany.mockResolvedValue([
      enrollment({ metadata: JSON.stringify({ gpu: "RTX 4090" }) }),
    ]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith("cus_1", {
      amount: -2500, // negative = credit
      currency: "usd",
      description: expect.stringContaining("$25"),
      metadata: expect.objectContaining({ type: "drip_credit" }),
    });
    expect(mockSendDripGpu1).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@x.com",
        gpu: "RTX 4090",
        creditApplied: true,
        dashboardUrl: expect.stringContaining("token=tok_drip"),
        unsubscribeUrl: expect.stringContaining("token=tok_unsub"),
      }),
    );
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: "enr-1" },
      data: expect.objectContaining({ currentStep: 1, lastSentAt: expect.any(Date) }),
    });
    expect(body.sent).toBe(1);
  });

  it("does not double-credit a customer who already has a drip_credit transaction", async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollment()]);
    mockListBalanceTransactions.mockResolvedValue({
      data: [{ metadata: { type: "drip_credit" } }],
    });

    await POST(makeRequest(SECRET));

    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    // Still reported as credit applied — the customer has it
    expect(mockSendDripApi1).toHaveBeenCalledWith(
      expect.objectContaining({ creditApplied: true }),
    );
  });

  it("cancels the drip when the customer has converted to paid billing", async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollment()]);
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_1",
      metadata: { billing_type: "hourly" },
    });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: "enr-1" },
      data: { status: "cancelled", cancelledAt: expect.any(Date) },
    });
    expect(body.sent).toBe(0);
    expect(mockSendDripApi1).not.toHaveBeenCalled();
    expect(mockSendDripGpu1).not.toHaveBeenCalled();
  });

  it("uses the API template family when no gpu is in the metadata", async () => {
    mockEnrollmentFindMany.mockResolvedValue([
      enrollment({
        currentStep: 1,
        lastSentAt: new Date(Date.now() - 30 * HOUR_MS),
      }),
    ]);

    await POST(makeRequest(SECRET));

    expect(mockSendDripApi2).toHaveBeenCalledTimes(1);
    expect(mockSendDripGpu2).not.toHaveBeenCalled();
    // Credit is first-step-only
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });

  it("marks the enrollment completed on the final step", async () => {
    mockEnrollmentFindMany.mockResolvedValue([
      enrollment({
        currentStep: 2,
        lastSentAt: new Date(Date.now() - 30 * HOUR_MS),
      }),
    ]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockSendDripApi3).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: "enr-1" },
      data: expect.objectContaining({
        currentStep: 3,
        status: "completed",
        completedAt: expect.any(Date),
      }),
    });
    expect(body.completed).toBe(1);
  });

  it("completes enrollments that already ran past the last step", async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollment({ currentStep: 3 })]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: "enr-1" },
      data: { status: "completed", completedAt: expect.any(Date) },
    });
    expect(body.completed).toBe(1);
    expect(body.sent).toBe(0);
  });

  it("does not advance the enrollment when the email send fails", async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollment()]);
    mockSendDripApi1.mockRejectedValue(new Error("SMTP down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.errors).toBe(1);
    expect(body.sent).toBe(0);
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled(); // retried next run
  });

  it("skips the round (without cancelling) when Stripe is unreachable", async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollment()]);
    mockCustomersRetrieve.mockRejectedValue(new Error("stripe down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.skipped).toBe(1);
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when the enrollment query fails", async () => {
    mockEnrollmentFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to process drip campaigns");
  });
});
