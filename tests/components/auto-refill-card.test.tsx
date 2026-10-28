// @vitest-environment jsdom
//
// PA-195: AutoRefillCard — customer-set, opt-in auto-refill control in the
// Billing tab. Verifies opt-in default, the save POST body, the no-payment-method
// warning, and the read-only state for non-billing-managers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutoRefillCard, type AutoRefillSettings } from "@/app/dashboard/components/AutoRefillCard";

function mockFetch(autoRefill: unknown, ok = true) {
  const f = vi.fn().mockResolvedValue({ ok, json: async () => ({ autoRefill }) });
  global.fetch = f as unknown as typeof fetch;
  return f;
}

const ENABLED: AutoRefillSettings = {
  enabled: true,
  amountCents: 50000,
  thresholdCents: 10000,
  hasPaymentMethod: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AutoRefillCard", () => {
  it("is off by default (opt-in) and hides the amount inputs", () => {
    render(<AutoRefillCard settings={null} token="t" canManage />);
    expect(screen.getByText("Auto-Refill")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("Top up by")).toBeNull();
  });

  it("shows the customer's saved amount and threshold when enabled", () => {
    render(<AutoRefillCard settings={ENABLED} token="t" canManage />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    const nums = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(nums.map((n) => n.value)).toEqual(["500", "100"]); // $500 top-up, $100 threshold
  });

  it("POSTs the chosen settings to /api/account/auto-refill on Save", async () => {
    const f = mockFetch({ enabled: true, amountCents: 60000, thresholdCents: 10000, hasPaymentMethod: true });
    render(<AutoRefillCard settings={ENABLED} token="tok-123" canManage />);

    // Change a value so there's something to save (Save is disabled otherwise — PA-338).
    const [amountInput] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(amountInput, { target: { value: "600" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(f).toHaveBeenCalled());
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe("/api/account/auto-refill");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok-123");
    expect(JSON.parse(opts.body)).toEqual({ enabled: true, amountCents: 60000, thresholdCents: 10000 });
    await waitFor(() => expect(screen.getByText("Saved ✓")).toBeTruthy());
  });

  // PA-338: Save must be a no-op with no confirmation when nothing has changed.
  it("disables Save and shows no confirmation when nothing has changed", () => {
    const f = mockFetch({ enabled: true, amountCents: 50000, thresholdCents: 10000, hasPaymentMethod: true });
    render(<AutoRefillCard settings={ENABLED} token="t" canManage />);

    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Saved ✓")).toBeNull();
    // A click on the disabled button must not POST or confirm.
    fireEvent.click(screen.getByText("Save"));
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved ✓")).toBeNull();
  });

  it("re-disables Save after a successful save so a no-op re-click can't re-confirm (PA-338)", async () => {
    const f = mockFetch({ enabled: true, amountCents: 60000, thresholdCents: 10000, hasPaymentMethod: true });
    render(<AutoRefillCard settings={ENABLED} token="t" canManage />);

    const [amountInput] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(amountInput, { target: { value: "600" } });
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Saved ✓")).toBeTruthy());

    // Baseline is now the saved values → Save disabled again, and it stays a single POST.
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Save"));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("warns when enabled without a saved payment method", () => {
    render(
      <AutoRefillCard
        settings={{ ...ENABLED, hasPaymentMethod: false }}
        token="t"
        billingPortalUrl="https://portal.example"
        canManage
      />,
    );
    expect(screen.getByText(/needs a saved card/i)).toBeTruthy();
    expect((screen.getByText("Add a payment method") as HTMLAnchorElement).getAttribute("href")).toBe(
      "https://portal.example",
    );
  });

  it("is read-only for users who cannot manage billing", () => {
    render(<AutoRefillCard settings={ENABLED} token="t" canManage={false} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only billing managers/i)).toBeTruthy();
  });
});
