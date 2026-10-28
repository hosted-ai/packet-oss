// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — VouchersTab.
// Self-fetches /api/admin/vouchers, renders stats + table, POSTs to create,
// PATCHes to update/toggle, DELETEs (?id=), and loads redemptions on demand.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { VouchersTab } from "@/app/admin/components/VouchersTab";

type Json = Record<string, unknown>;

let vouchers: Json[];
let stats: Json | null;
let redemptions: Json[];

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/vouchers" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ vouchers, stats }) });
    }
    if (url.startsWith("/api/admin/vouchers?id=") && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ voucher: { redemptions } }) });
    }
    // POST / PATCH / DELETE
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseStats = (): Json => ({
  totalVouchers: 4,
  activeVouchers: 3,
  totalRedemptions: 20,
  totalCreditedCents: 50000,
  redemptionsThisMonth: 6,
  creditedThisMonthCents: 15000,
});

const sampleVoucher = (over: Json = {}): Json => ({
  id: "v-1",
  code: "LAUNCH50",
  name: "Launch Promo",
  description: "Welcome credit",
  creditCents: 5000,
  minTopupCents: null,
  maxRedemptions: 100,
  redemptionCount: 0,
  maxPerCustomer: 1,
  startsAt: null,
  expiresAt: null,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  createdBy: "admin",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  vouchers = [];
  stats = baseStats();
  redemptions = [];
});

describe("VouchersTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<VouchersTab />);
    expect(screen.getByText(/loading vouchers/i)).toBeInTheDocument();
  });

  it("renders the stats cards from the API", async () => {
    makeFetch();
    render(<VouchersTab />);
    await screen.findByText(/voucher codes/i);
    expect(screen.getByText("4")).toBeInTheDocument(); // total vouchers
    expect(screen.getByText("$500")).toBeInTheDocument(); // 50000c credited
  });

  it("renders the empty table state when there are no vouchers", async () => {
    makeFetch();
    render(<VouchersTab />);
    expect(await screen.findByText(/no vouchers created yet/i)).toBeInTheDocument();
  });

  it("renders a voucher row with code, credit and redemptions", async () => {
    vouchers = [sampleVoucher()];
    makeFetch();
    render(<VouchersTab />);
    await screen.findByText("LAUNCH50");
    expect(screen.getByText("Launch Promo")).toBeInTheDocument();
    expect(screen.getByText("+$50")).toBeInTheDocument();
    expect(screen.getByText("0/100")).toBeInTheDocument();
  });

  it("opens the create modal and POSTs the cleaned form", async () => {
    const fetchMock = makeFetch();
    render(<VouchersTab />);
    await screen.findByText(/no vouchers created yet/i);

    fireEvent.click(screen.getByRole("button", { name: /create voucher/i }));
    const codeInput = screen.getByPlaceholderText("LAUNCH50");
    fireEvent.change(codeInput, { target: { value: "save10" } });
    fireEvent.change(screen.getByPlaceholderText("Launch Promotion"), {
      target: { value: "Save Ten" },
    });
    fireEvent.submit(codeInput.closest("form")!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/vouchers" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.code).toBe("SAVE10"); // upper-cased + trimmed
      expect(body.name).toBe("Save Ten");
    });
  });

  it("blocks submission with an alert when the code is empty", async () => {
    makeFetch();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<VouchersTab />);
    await screen.findByText(/no vouchers created yet/i);

    fireEvent.click(screen.getByRole("button", { name: /create voucher/i }));
    const nameInput = screen.getByPlaceholderText("Launch Promotion");
    fireEvent.change(nameInput, { target: { value: "No code" } });
    fireEvent.submit(nameInput.closest("form")!);
    expect(alertSpy).toHaveBeenCalledWith("Code is required");
    alertSpy.mockRestore();
  });

  it("opens the edit modal prefilled and PATCHes with the id", async () => {
    vouchers = [sampleVoucher()];
    const fetchMock = makeFetch();
    render(<VouchersTab />);
    await screen.findByText("LAUNCH50");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("heading", { name: /edit voucher/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Launch Promo")).toBeInTheDocument();

    const codeInput = screen.getByDisplayValue("LAUNCH50");
    fireEvent.submit(codeInput.closest("form")!);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).id).toBe("v-1");
    });
  });

  it("PATCHes active toggle when the status badge is clicked", async () => {
    vouchers = [sampleVoucher({ active: true })];
    const fetchMock = makeFetch();
    render(<VouchersTab />);
    await screen.findByText("LAUNCH50");

    fireEvent.click(screen.getByRole("button", { name: /^active$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "PATCH" &&
          JSON.parse((c[1]!.body as string)).active === false
      );
      expect(call).toBeTruthy();
    });
  });

  it("DELETEs a never-redeemed voucher after confirmation", async () => {
    vouchers = [sampleVoucher({ redemptionCount: 0 })];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VouchersTab />);
    await screen.findByText("LAUNCH50");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => (c[0] as string) === "/api/admin/vouchers?id=v-1" && c[1]?.method === "DELETE"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("hides Delete for vouchers that already have redemptions", async () => {
    vouchers = [sampleVoucher({ redemptionCount: 3 })];
    makeFetch();
    render(<VouchersTab />);
    await screen.findByText("LAUNCH50");
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("loads and renders redemptions when the count is clicked", async () => {
    vouchers = [sampleVoucher({ redemptionCount: 1 })];
    redemptions = [
      {
        id: "r-1",
        stripeCustomerId: "cus_1",
        customerEmail: "buyer@example.com",
        topupCents: 10000,
        creditCents: 5000,
        createdAt: "2026-01-02T00:00:00Z",
      },
    ];
    const fetchMock = makeFetch();
    render(<VouchersTab />);
    await screen.findByText("LAUNCH50");

    // The redemption count is a button ("1/100").
    fireEvent.click(screen.getByRole("button", { name: /1\/100/ }));
    expect(await screen.findByText(/redemptions for LAUNCH50/i)).toBeInTheDocument();
    expect(await screen.findByText("buyer@example.com")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((c) => (c[0] as string) === "/api/admin/vouchers?id=v-1")
    ).toBe(true);
  });

  // PA-204 — long Code/Description text used to stretch the table past the
  // `overflow-hidden` card, clipping the rightmost ACTIONS column with no
  // horizontal scrollbar. Guard the DOM contract that fixes it: the table sits
  // in an `overflow-x-auto` wrapper, and the long-text cells are clamped with
  // `truncate`/`max-w-*` + a `title` tooltip. (jsdom has no layout engine, so
  // this pins the mechanism rather than measuring pixels.)
  describe("long-text layout (PA-204)", () => {
    const longCode = "PROMO-" + "A".repeat(120);
    const longDescription =
      "This is an unusually long promotional voucher description that comfortably " +
      "exceeds one hundred characters so it reproduces the PA-204 column overflow.";

    it("keeps the Edit/Delete actions rendered for a row with long code and description", async () => {
      vouchers = [
        sampleVoucher({ code: longCode, description: longDescription, redemptionCount: 0 }),
      ];
      makeFetch();
      render(<VouchersTab />);
      await screen.findByText(longCode);

      // ACTIONS column stays reachable — buttons are in the DOM, not clipped away.
      expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    });

    it("wraps the table in a horizontal-scroll container", async () => {
      vouchers = [sampleVoucher({ code: longCode, description: longDescription })];
      makeFetch();
      const { container } = render(<VouchersTab />);
      await screen.findByText(longCode);

      const table = container.querySelector("table");
      expect(table).not.toBeNull();
      expect(table!.closest(".overflow-x-auto")).not.toBeNull();
    });

    it("truncates the code and description cells with a title tooltip", async () => {
      vouchers = [sampleVoucher({ code: longCode, description: longDescription })];
      makeFetch();
      render(<VouchersTab />);
      await screen.findByText(longCode);

      const codeCell = screen.getByText(longCode).closest("td")!;
      expect(codeCell.className).toContain("truncate");
      expect(codeCell.className).toMatch(/max-w-/);
      expect(codeCell).toHaveAttribute("title", longCode);

      const descCell = screen.getByText(longDescription);
      expect(descCell.className).toContain("truncate");
      expect(descCell.className).toMatch(/max-w-/);
      expect(descCell).toHaveAttribute("title", longDescription);
    });
  });
});
