// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. BlackwellModal is a presentational upsell that
// fetches /api/products on open, finds the first monthly product with a
// stripePriceId, and gates its CTA on (product loaded + customerEmail). The
// CTA POSTs /api/checkout with termsAccepted:true and redirects; errors show
// inline. When no product loads the CTA reads "Product unavailable".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BlackwellModal } from "@/app/dashboard/components/modals/BlackwellModal";

const product = {
  id: "prod_bw",
  name: "Blackwell",
  billingType: "monthly",
  pricePerMonthCents: 19900,
  pricePerHourCents: 0,
  stripePriceId: "price_bw",
};

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("BlackwellModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    stubFetch();
    const { container } = render(
      <BlackwellModal isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the GPU spec content when open", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [product] }) });

    render(<BlackwellModal isOpen onClose={vi.fn()} customerEmail="u@test.dev" />);

    expect(screen.getByRole("heading", { name: /NVIDIA RTX PRO 6000/i })).toBeInTheDocument();
    expect(screen.getByText(/Limited availability/i)).toBeInTheDocument();
    expect(screen.getByText(/Blackwell Architecture/i)).toBeInTheDocument();
  });

  it("enables the subscribe CTA with the product price once loaded", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [product] }) });

    render(<BlackwellModal isOpen onClose={vi.fn()} customerEmail="u@test.dev" />);

    expect(
      await screen.findByRole("button", { name: /Subscribe — \$199\/mo/i }),
    ).toBeEnabled();
  });

  it("shows 'Product unavailable' and a disabled CTA when no product loads", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

    render(<BlackwellModal isOpen onClose={vi.fn()} customerEmail="u@test.dev" />);

    const cta = await screen.findByRole("button", { name: /Product unavailable/i });
    expect(cta).toBeDisabled();
  });

  it("POSTs /api/checkout with termsAccepted and redirects on success", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [product] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://stripe.test/go" }) });

    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { set href(v: string) { hrefSetter(v); } },
    });

    render(<BlackwellModal isOpen onClose={vi.fn()} customerEmail="u@test.dev" />);

    const cta = await screen.findByRole("button", { name: /Subscribe — \$199\/mo/i });
    fireEvent.click(cta);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/checkout",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toEqual({
      productId: "prod_bw",
      email: "u@test.dev",
      termsAccepted: true,
    });
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith("https://stripe.test/go"),
    );
  });

  it("surfaces a checkout error inline", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [product] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "No seats left" }) });

    render(<BlackwellModal isOpen onClose={vi.fn()} customerEmail="u@test.dev" />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Subscribe — \$199\/mo/i }),
    );
    expect(await screen.findByText("No seats left")).toBeInTheDocument();
  });

  it("does not attempt checkout without a customerEmail", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [product] }) });

    render(<BlackwellModal isOpen onClose={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Subscribe — \$199\/mo/i }),
    );
    // Only the products fetch should have fired; no checkout POST.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/checkout",
      expect.anything(),
    );
  });

  it("fires onClose from the backdrop/close button", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [product] }) });

    const onClose = vi.fn();
    render(<BlackwellModal isOpen onClose={onClose} customerEmail="u@test.dev" />);
    // The close (X) button is the first button rendered.
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
