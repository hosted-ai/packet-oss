// Tests for src/app/api/account/profile/route.ts (PA-287 + PA-231).
//
// Customer profile read/write. name/email/phone + light metadata live on the
// Stripe customer; the KYC / billing fields (company, address, country, etc.)
// live on CustomerSettings. BOTH key on auth.accountId (the operating account).
//
// Pinned contracts:
//   * Auth delegated to getAuthenticatedCustomer; its NextResponse (401/403/404)
//     is returned as-is and no write happens
//   * GET merges the Stripe customer + CustomerSettings KYC into the flat shape;
//     company falls back to legacy metadata.company when companyName is unset
//   * PUT writes the Stripe customer + upserts CustomerSettings, BOTH on accountId
//   * PA-231: writes target the operating account, not payload.customerId
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockCacheCustomer,
  mockStripeUpdate,
  mockSettingsFindUnique,
  mockSettingsUpsert,
  mockRequirePermission,
  mockCan,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockCacheCustomer: vi.fn(),
  mockStripeUpdate: vi.fn(),
  mockSettingsFindUnique: vi.fn(),
  mockSettingsUpsert: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockCan: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerSettings: {
      findUnique: mockSettingsFindUnique,
      upsert: mockSettingsUpsert,
    },
  },
}));

import { GET, PUT } from "@/app/api/account/profile/route";

const CUSTOMER = {
  id: "cus_profile",
  name: "Acme",
  email: "p@example.com",
  phone: "+15551234567",
  metadata: {
    company: "Acme Inc", // legacy — superseded by CustomerSettings.companyName
    job_title: "CTO",
    website: "https://acme.test",
    timezone: "UTC",
    use_case: "training",
  },
};

const SETTINGS = {
  personalAddress: "1 Main St",
  country: "US",
  zipCode: "90001",
  companyName: "Acme Inc",
  companyAddress: "1 HQ Plaza",
  companyRegNumber: "REG-1",
  companyCountry: "US",
  companyZipCode: "94105",
  companyWebsite: "https://acme.test",
};

function authContext() {
  return {
    payload: { customerId: "cus_profile", email: "p@example.com" },
    customer: CUSTOMER,
    // Operating account the request acts on. For a solo owner this equals
    // payload.customerId; for a team member / payer≠owner it diverges (PA-231).
    accountId: "cus_profile",
    stripe: { customers: { update: mockStripeUpdate } },
    can: mockCan,
  };
}

function makeRequest(method: "GET" | "PUT", { body }: { body?: unknown } = {}) {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/account/profile", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(authContext());
  mockCacheCustomer.mockResolvedValue(undefined);
  mockStripeUpdate.mockResolvedValue(CUSTOMER);
  mockSettingsFindUnique.mockResolvedValue(SETTINGS);
  mockSettingsUpsert.mockResolvedValue(SETTINGS);
  mockRequirePermission.mockReturnValue(null); // permission granted by default
  mockCan.mockReturnValue(true); // has billing.view by default (owner)
});

describe("GET /api/account/profile", () => {
  it("returns the auth NextResponse (401) verbatim when unauthenticated", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(401);
  });

  it("merges the Stripe customer + KYC settings into the flat profile shape", async () => {
    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSettingsFindUnique).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_profile" },
      select: expect.any(Object),
    });
    expect(body.success).toBe(true);
    expect(body.profile).toEqual({
      name: "Acme",
      email: "p@example.com",
      phone: "+15551234567",
      jobTitle: "CTO",
      website: "https://acme.test",
      timezone: "UTC",
      useCase: "training",
      company: "Acme Inc",
      personalAddress: "1 Main St",
      country: "US",
      zipCode: "90001",
      companyAddress: "1 HQ Plaza",
      companyRegNumber: "REG-1",
      companyCountry: "US",
      companyZipCode: "94105",
      companyWebsite: "https://acme.test",
    });
    // Live embargo set for the country dropdown (empty here — embargo unmocked).
    expect(Array.isArray(body.embargoedCountries)).toBe(true);
  });

  it("falls back to legacy metadata.company when companyName is unset", async () => {
    mockSettingsFindUnique.mockResolvedValue({ ...SETTINGS, companyName: null });
    const res = await GET(makeRequest("GET"));
    const body = await res.json();
    expect(body.profile.company).toBe("Acme Inc"); // from metadata.company
  });

  it("defaults missing fields to empty strings (no settings row)", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({
      ...authContext(),
      customer: { id: "cus_x", email: null, metadata: {} },
      accountId: "cus_x",
    });
    mockSettingsFindUnique.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.profile).toEqual({
      name: "",
      email: "",
      phone: "",
      jobTitle: "",
      website: "",
      timezone: "",
      useCase: "",
      company: "",
      personalAddress: "",
      country: "",
      zipCode: "",
      companyAddress: "",
      companyRegNumber: "",
      companyCountry: "",
      companyZipCode: "",
      companyWebsite: "",
    });
  });
});

describe("PUT /api/account/profile", () => {
  it("returns the auth NextResponse (401) verbatim when unauthenticated", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await PUT(makeRequest("PUT", { body: { name: "X" } }));
    expect(res.status).toBe(401);
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockSettingsUpsert).not.toHaveBeenCalled();
  });

  it("writes name/phone + metadata to Stripe and upserts KYC to CustomerSettings", async () => {
    mockStripeUpdate.mockResolvedValue({
      ...CUSTOMER,
      name: "New Name",
      phone: "+15559999999",
      metadata: { job_title: "VP", website: "https://new.test", timezone: "PST", use_case: "inference" },
    });
    mockSettingsUpsert.mockResolvedValue({
      personalAddress: "2 Elm",
      country: "GB",
      zipCode: "EC1",
      companyName: "NewCo",
      companyAddress: "2 Tower",
      companyRegNumber: "REG-2",
    });

    const res = await PUT(
      makeRequest("PUT", {
        body: {
          name: "New Name",
          company: "NewCo",
          phone: "+15559999999",
          jobTitle: "VP",
          website: "https://new.test",
          timezone: "PST",
          useCase: "inference",
          personalAddress: "2 Elm",
          country: "GB",
          zipCode: "EC1",
          companyAddress: "2 Tower",
          companyRegNumber: "REG-2",
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profile.name).toBe("New Name");
    expect(body.profile.company).toBe("NewCo");
    expect(body.profile.country).toBe("GB");

    // company is NOT a Stripe metadata key anymore.
    expect(mockStripeUpdate).toHaveBeenCalledWith("cus_profile", {
      name: "New Name",
      phone: "+15559999999",
      metadata: {
        job_title: "VP",
        website: "https://new.test",
        timezone: "PST",
        use_case: "inference",
      },
    });
    // KYC + company upserted on CustomerSettings, keyed on the operating account.
    expect(mockSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCustomerId: "cus_profile" },
        update: expect.objectContaining({ companyName: "NewCo", country: "GB", personalAddress: "2 Elm" }),
        create: expect.objectContaining({ stripeCustomerId: "cus_profile", companyName: "NewCo" }),
      }),
    );
    expect(mockCacheCustomer).toHaveBeenCalled();
  });

  it("returns 500 when the Stripe update throws", async () => {
    mockStripeUpdate.mockRejectedValue(new Error("stripe down"));
    const res = await PUT(makeRequest("PUT", { body: { name: "X" } }));
    expect(res.status).toBe(500);
  });
});

// PA-231: "profile changes are not being saved from Settings". Root cause —
// GET reads the operating account (auth.customer / accountId) but PUT wrote
// payload.customerId. They match for a solo owner (every internal test → not
// reproducible) but diverge for a team member / payer≠owner, so the save
// landed on the wrong record and silently never persisted. The fix: read AND
// write the operating account (auth.accountId) consistently.
describe("PA-231 regression — profile read/write key on the operating account", () => {
  function memberContext() {
    return {
      ...authContext(),
      payload: { customerId: "cus_personal", email: "member@example.com" },
      customer: { ...CUSTOMER, id: "cus_account" },
      accountId: "cus_account",
    };
  }

  it("PUT writes the operating account on BOTH Stripe and CustomerSettings, NOT the personal JWT id", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(memberContext());
    mockStripeUpdate.mockResolvedValue({ ...CUSTOMER, id: "cus_account" });

    await PUT(makeRequest("PUT", { body: { company: "SavedCo", name: "Saver" } }));

    expect(mockStripeUpdate).toHaveBeenCalledWith("cus_account", expect.anything());
    expect(mockStripeUpdate).not.toHaveBeenCalledWith("cus_personal", expect.anything());
    expect(mockSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: "cus_account" } }),
    );
  });

  it("GET reads KYC for the operating account, not the personal JWT id", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(memberContext());
    await GET(makeRequest("GET"));
    expect(mockSettingsFindUnique).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_account" },
      select: expect.any(Object),
    });
  });

  it("solo owner (payload.customerId === accountId) is unaffected", async () => {
    await PUT(makeRequest("PUT", { body: { name: "X" } }));
    expect(mockStripeUpdate).toHaveBeenCalledWith("cus_profile", expect.anything());
  });
});

// RBAC: the profile is the operating account's billing/KYC identity. PUT is
// gated to billing.manage; GET redacts KYC for members without billing.view.
describe("RBAC — profile billing/KYC is gated", () => {
  it("PUT is denied (no Stripe/DB write) when the member lacks billing.manage", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await PUT(makeRequest("PUT", { body: { company: "X", name: "Y" } }));
    expect(res.status).toBe(403);
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockSettingsUpsert).not.toHaveBeenCalled();
  });

  it("GET redacts KYC (and skips the settings query) for a member without billing.view", async () => {
    mockCan.mockReturnValue(false); // no billing.view
    const res = await GET(makeRequest("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    // basic profile still visible
    expect(body.profile.name).toBe("Acme");
    expect(body.profile.email).toBe("p@example.com");
    // KYC redacted
    expect(body.profile.company).toBe("");
    expect(body.profile.personalAddress).toBe("");
    expect(body.profile.companyAddress).toBe("");
    expect(body.profile.country).toBe("");
    // and we don't even query the KYC row
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
});
