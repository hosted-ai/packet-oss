// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /checkout page. NOTE: this
// page does NOT use Stripe Elements / @stripe/stripe-js — it is a server-driven
// (Stripe-hosted) checkout. On mount it GETs /api/products (envelope:
// { success, data: GpuProduct[] }) and pre-selects the product matched from
// the ?product / ?gpu URL param (exact id, then partial id/name), else the
// featured product, else the first. Submit validates email + terms client-side,
// then POSTs { email, productId, voucherCode?, termsAccepted } to /api/checkout
// and redirects to the returned `url`. A voucher can be applied via
// /api/voucher/validate. plerdy tracking is a fire-and-forget dynamic import.
//
// useSearchParams is driven via a mutable map; useBranding/BrandLogo/
// branding-client and @/lib/plerdy are stubbed; fetch is stubbed by URL.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

let currentParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k in currentParams ? currentParams[k] : null),
  }),
}));

vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="brand-logo" />,
}));
vi.mock("@/lib/branding-client", () => ({
  getLogoUrl: () => "/logo.svg",
  getBrandName: () => "Test Brand",
}));
// plerdy is dynamically imported on voucher/deposit events; keep it inert.
vi.mock("@/lib/plerdy", () => ({
  trackPlerdy: vi.fn(),
  PLERDY_EVENTS: { VOUCHER_REDEEMED: "voucher_redeemed", DEPOSIT_STARTED: "deposit_started" },
}));

import CheckoutPage from "@/app/checkout/page";

const hourlyProduct = {
  id: "rtx-4090",
  name: "RTX 4090",
  description: "Fast GPU",
  billingType: "hourly",
  pricePerHourCents: 250,
  pricePerMonthCents: null,
  stripeProductId: null,
  stripePriceId: null,
  featured: true,
  badgeText: "Popular",
  vramGb: 24,
  cudaCores: 16384,
};

const monthlyProduct = {
  id: "a100-sub",
  name: "A100 Monthly",
  description: "Subscription GPU",
  billingType: "monthly",
  pricePerHourCents: 500,
  pricePerMonthCents: 99900,
  stripeProductId: null,
  stripePriceId: null,
  featured: false,
  badgeText: null,
  vramGb: 80,
  cudaCores: 6912,
};

// Route fetch by URL. Each entry: matcher substring -> response factory.
function routeFetch(routes: Record<string, { ok?: boolean; body: unknown }>) {
  const fetchMock = vi.fn((url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { ok: true, body: {} };
    return Promise.resolve({ ok: r.ok ?? true, json: async () => r.body });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let hrefSpy: ReturnType<typeof vi.fn>;
function installLocation() {
  hrefSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(v: string) {
        hrefSpy(v);
      },
      get href() {
        return "";
      },
    },
  });
}

beforeEach(() => {
  currentParams = {};
  vi.unstubAllGlobals();
  installLocation();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CheckoutPage (PA-289)", () => {
  it("shows a spinner-only state until products load (no products rendered yet)", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<CheckoutPage />);
    // Heading falls back to "Add Funds" (no selected product yet) but no
    // product buttons are present while loading.
    expect(screen.queryByRole("button", { name: /rtx 4090/i })).not.toBeInTheDocument();
  });

  it("loads an hourly product and shows the Add Funds / initial-deposit copy", async () => {
    // PA-319 regression guard: monthly (not featured) is listed FIRST and
    // hourly (featured) second. With no ?product/?gpu param the featured
    // product must still win over list order.
    routeFetch({ "/api/products": { body: { success: true, data: [monthlyProduct, hourlyProduct] } } });
    render(<CheckoutPage />);
    expect(await screen.findByRole("heading", { name: /add funds/i })).toBeInTheDocument();
    // The summary panel's label is exactly "Initial deposit:" (distinct from
    // the intro sentence that also contains "initial deposit").
    expect(screen.getByText("Initial deposit:")).toBeInTheDocument();
    // 250 cents -> $2.50/hour pay-as-you-go (selected-product summary panel).
    expect(screen.getByText(/pay-as-you-go at \$2\.50\/hour/i)).toBeInTheDocument();
  });

  it("pre-selects the product named in the ?product URL param", async () => {
    currentParams = { product: "A100" };
    routeFetch({ "/api/products": { body: { success: true, data: [hourlyProduct, monthlyProduct] } } });
    render(<CheckoutPage />);
    // Monthly product selected -> "Subscribe" heading + monthly summary.
    expect(await screen.findByRole("heading", { name: /subscribe/i })).toBeInTheDocument();
    expect(screen.getByText(/monthly subscription/i)).toBeInTheDocument();
  });

  it("also honours the legacy ?gpu URL param", async () => {
    currentParams = { gpu: "a100-sub" };
    routeFetch({ "/api/products": { body: { success: true, data: [hourlyProduct, monthlyProduct] } } });
    render(<CheckoutPage />);
    expect(await screen.findByRole("heading", { name: /subscribe/i })).toBeInTheDocument();
  });

  it("renders the no-products notice when the catalog is empty", async () => {
    routeFetch({ "/api/products": { body: { success: true, data: [] } } });
    render(<CheckoutPage />);
    expect(await screen.findByText(/no products available/i)).toBeInTheDocument();
  });

  it("pre-fills the email field from the ?email URL param", async () => {
    currentParams = { email: "buyer@example.com" };
    routeFetch({ "/api/products": { body: { success: true, data: [hourlyProduct] } } });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });
    expect(screen.getByDisplayValue("buyer@example.com")).toBeInTheDocument();
  });

  it("blocks submit and shows an error for an invalid email", async () => {
    const fetchMock = routeFetch({
      "/api/products": { body: { success: true, data: [hourlyProduct] } },
    });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    fireEvent.click(screen.getByLabelText(/i agree to the/i));
    // Submit with empty email.
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));

    expect(await screen.findByText(/please enter a valid email address/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/checkout"))).toBe(false);
  });

  it("keeps submit disabled until terms are accepted", async () => {
    routeFetch({ "/api/products": { body: { success: true, data: [hourlyProduct] } } });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    const submit = screen.getByRole("button", { name: /continue to payment/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/i agree to the/i));
    expect(submit).toBeEnabled();
  });

  it("POSTs the checkout payload and redirects to the returned Stripe URL", async () => {
    const fetchMock = routeFetch({
      "/api/products": { body: { success: true, data: [hourlyProduct] } },
      "/api/checkout": { ok: true, body: { url: "https://stripe.test/session/cs_1" } },
    });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    fireEvent.change(screen.getByPlaceholderText(/enter your email/i), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(screen.getByLabelText(/i agree to the/i));
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));

    await waitFor(() =>
      expect(hrefSpy).toHaveBeenCalledWith("https://stripe.test/session/cs_1"),
    );
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/checkout"));
    expect(JSON.parse(post?.[1]?.body)).toEqual({
      email: "buyer@example.com",
      productId: "rtx-4090",
      voucherCode: undefined,
      termsAccepted: true,
    });
  });

  it("surfaces the server error when checkout creation fails", async () => {
    routeFetch({
      "/api/products": { body: { success: true, data: [hourlyProduct] } },
      "/api/checkout": { ok: false, body: { error: "Payment provider unavailable" } },
    });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    fireEvent.change(screen.getByPlaceholderText(/enter your email/i), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(screen.getByLabelText(/i agree to the/i));
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));

    expect(await screen.findByText(/payment provider unavailable/i)).toBeInTheDocument();
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  it("validates a voucher and shows the applied-credit summary", async () => {
    routeFetch({
      "/api/products": { body: { success: true, data: [hourlyProduct] } },
      "/api/voucher/validate": {
        ok: true,
        body: {
          success: true,
          voucher: { code: "SAVE20", name: "Launch Promo", creditCents: 2000, minTopupCents: null },
        },
      },
    });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    fireEvent.click(screen.getByRole("button", { name: /have a voucher code/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter code/i), { target: { value: "save20" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/launch promo/i)).toBeInTheDocument();
    expect(screen.getByText(/\$20 credit applied/i)).toBeInTheDocument();
  });

  it("shows the voucher error message for an invalid voucher", async () => {
    routeFetch({
      "/api/products": { body: { success: true, data: [hourlyProduct] } },
      "/api/voucher/validate": { ok: true, body: { success: false, error: "Voucher not found" } },
    });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    fireEvent.click(screen.getByRole("button", { name: /have a voucher code/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter code/i), { target: { value: "bogus" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/voucher not found/i)).toBeInTheDocument();
  });

  it("includes the validated voucher code in the checkout POST", async () => {
    const fetchMock = routeFetch({
      "/api/products": { body: { success: true, data: [hourlyProduct] } },
      "/api/voucher/validate": {
        ok: true,
        body: {
          success: true,
          voucher: { code: "SAVE20", name: "Launch Promo", creditCents: 2000, minTopupCents: null },
        },
      },
      "/api/checkout": { ok: true, body: { url: "https://stripe.test/session/cs_2" } },
    });
    render(<CheckoutPage />);
    await screen.findByRole("heading", { name: /add funds/i });

    fireEvent.click(screen.getByRole("button", { name: /have a voucher code/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter code/i), { target: { value: "save20" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    await screen.findByText(/launch promo/i);

    fireEvent.change(screen.getByPlaceholderText(/enter your email/i), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(screen.getByLabelText(/i agree to the/i));
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/checkout"))).toBe(true),
    );
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/checkout"));
    expect(JSON.parse(post?.[1]?.body).voucherCode).toBe("SAVE20");
  });

  it("renders a Start Subscription CTA for a monthly product", async () => {
    currentParams = { product: "a100-sub" };
    routeFetch({ "/api/products": { body: { success: true, data: [hourlyProduct, monthlyProduct] } } });
    render(<CheckoutPage />);
    expect(
      await screen.findByRole("button", { name: /start subscription/i }),
    ).toBeInTheDocument();
    // Voucher entry is hidden for monthly products.
    expect(screen.queryByRole("button", { name: /have a voucher code/i })).not.toBeInTheDocument();
  });
});
