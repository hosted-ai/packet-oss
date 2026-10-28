// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. BillingTypeModal fetches /api/products on open,
// picks the first monthly product with a stripePriceId, and presents a
// monthly vs hourly choice. Monthly fires POST /api/checkout (disabled until a
// product loads + customerEmail is present); hourly closes and calls
// onSelectHourly. Checkout errors surface inline.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BillingTypeModal } from "@/app/dashboard/components/modals/BillingTypeModal";

const monthlyProduct = {
  id: "prod_monthly",
  name: "Monthly RTX",
  billingType: "monthly",
  pricePerMonthCents: 19900,
  pricePerHourCents: 0,
  stripePriceId: "price_123",
};

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("BillingTypeModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    stubFetch();
    const { container } = render(
      <BillingTypeModal isOpen={false} onClose={vi.fn()} onSelectHourly={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fetches products on open and shows the monthly price from the product", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [monthlyProduct] }),
    });

    render(
      <BillingTypeModal
        isOpen
        onClose={vi.fn()}
        onSelectHourly={vi.fn()}
        customerEmail="user@test.dev"
      />,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/products"),
    );
    // 19900 cents -> $199/month
    expect(await screen.findByText("$199")).toBeInTheDocument();
    expect(screen.getByText(/best value/i)).toBeInTheDocument();
  });

  it("falls back to default pricing when no monthly product is found", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    render(
      <BillingTypeModal isOpen onClose={vi.fn()} onSelectHourly={vi.fn()} />,
    );
    // Default monthlyPrice is "199" when no product loads.
    expect(await screen.findByText("$199")).toBeInTheDocument();
  });

  it("POSTs to /api/checkout with the product id and email and redirects", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [monthlyProduct] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://stripe.test/session" }) });

    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { set href(v: string) { hrefSetter(v); } },
    });

    render(
      <BillingTypeModal
        isOpen
        onClose={vi.fn()}
        onSelectHourly={vi.fn()}
        customerEmail="user@test.dev"
      />,
    );

    // Wait for the product to load (enables the monthly button).
    await screen.findByText("$199");
    fireEvent.click(screen.getByText(/best value/i).closest("button")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/checkout",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toEqual({ productId: "prod_monthly", email: "user@test.dev" });
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith("https://stripe.test/session"),
    );
  });

  it("surfaces a checkout error inline", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [monthlyProduct] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Card declined" }) });

    render(
      <BillingTypeModal
        isOpen
        onClose={vi.fn()}
        onSelectHourly={vi.fn()}
        customerEmail="user@test.dev"
      />,
    );

    await screen.findByText("$199");
    fireEvent.click(screen.getByText(/best value/i).closest("button")!);

    expect(await screen.findByText("Card declined")).toBeInTheDocument();
  });

  it("closes and calls onSelectHourly when the hourly option is chosen", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [monthlyProduct] }) });

    const onClose = vi.fn();
    const onSelectHourly = vi.fn();
    render(
      <BillingTypeModal
        isOpen
        onClose={onClose}
        onSelectHourly={onSelectHourly}
        customerEmail="user@test.dev"
      />,
    );

    fireEvent.click(screen.getByText("$0.66").closest("button")!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectHourly).toHaveBeenCalledTimes(1);
  });

  it("fires onClose from the backdrop and the close button", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [monthlyProduct] }) });

    const onClose = vi.fn();
    render(
      <BillingTypeModal isOpen onClose={onClose} onSelectHourly={vi.fn()} />,
    );
    // The close (X) button is the first button rendered.
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
