// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — SettingsTab.
// Presentational billing-settings form. Heavy children (TwoFactorSettings,
// PoolSettingsSection) are stubbed so we exercise this tab's own logic.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub heavy children that own their own data flows.
vi.mock("@/components/two-factor/TwoFactorSettings", () => ({
  default: () => <div data-testid="two-factor-stub" />,
}));
vi.mock("@/app/admin/components/PoolSettingsSection", () => ({
  PoolSettingsSection: () => <div data-testid="pool-settings-stub" />,
}));
// RegionMaintenanceSection (added with the v0.8.3 region-maintenance feature)
// owns its own /api/admin/regions data flow — stub it so this tab's tests
// don't drive (and crash on) a child we don't cover here.
vi.mock("@/app/admin/components/RegionMaintenanceSection", () => ({
  RegionMaintenanceSection: () => <div data-testid="region-maintenance-stub" />,
}));

import { SettingsTab } from "@/app/admin/components/SettingsTab";
import type { PricingConfig } from "@/app/admin/types";

function makeFetch() {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const pricing: PricingConfig = {
  hourlyRateCents: 200,
  storagePricePerGBHourCents: 1,
  autoRefillThresholdCents: 2000,
  autoRefillAmountCents: 10000,
  stoppedInstanceRatePercent: 25,
  updatedAt: "2026-01-01T00:00:00Z",
  updatedBy: "admin@example.com",
};

function renderTab(overrides: Partial<React.ComponentProps<typeof SettingsTab>> = {}) {
  const props = {
    pricing,
    pricingForm: {
      hourlyRate: "2.00",
      refillThreshold: "20.00",
      refillAmount: "100.00",
      stoppedInstanceRate: "25",
    },
    pricingSaving: false,
    onPricingFormChange: vi.fn(),
    onSavePricing: vi.fn((e: React.FormEvent) => e.preventDefault()),
    ...overrides,
  };
  render(<SettingsTab {...props} />);
  return props;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsTab", () => {
  it("renders the billing-settings heading and prefilled refill fields", () => {
    makeFetch();
    renderTab();
    expect(screen.getByText(/billing settings/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("20.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
  });

  it("renders the last-updated attribution from pricing", () => {
    makeFetch();
    renderTab();
    expect(screen.getByText(/last updated:/i)).toBeInTheDocument();
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
  });

  it("fires onPricingFormChange when the refill threshold changes", () => {
    makeFetch();
    const props = renderTab();
    fireEvent.change(screen.getByDisplayValue("20.00"), { target: { value: "30.00" } });
    expect(props.onPricingFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ refillThreshold: "30.00" })
    );
  });

  it("fires onSavePricing when the billing form is submitted", () => {
    makeFetch();
    const props = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /save pricing/i }));
    expect(props.onSavePricing).toHaveBeenCalled();
  });

  it("disables Save Pricing while pricingSaving is true", () => {
    makeFetch();
    renderTab({ pricingSaving: true });
    expect(screen.getByRole("button", { name: /saving\.\.\./i })).toBeDisabled();
  });

  it("renders the stubbed two-factor and pool-settings children", () => {
    makeFetch();
    renderTab();
    expect(screen.getByTestId("two-factor-stub")).toBeInTheDocument();
    expect(screen.getByTestId("pool-settings-stub")).toBeInTheDocument();
  });
});
