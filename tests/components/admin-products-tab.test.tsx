// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — ProductsTab.
// Self-fetches gpu-products + pool-settings + pricing on mount, renders the
// products table + storage-pricing + categories, and POSTs {action} for
// product/category CRUD, PUTs storage pricing. Heavy/premium children are
// stubbed: ServicePickerDialog (OSS) and the isPro()-gated dynamic
// TokenFactoryPricingSection (premium, excluded in the OSS build).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub the dynamic-import helper so the premium TokenFactoryPricingSection is
// never resolved (it is excluded from the OSS export).
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/app/admin/components/ServicePickerDialog", () => ({
  ServicePickerDialog: () => null,
}));

import { ProductsTab } from "@/app/admin/components/ProductsTab";

type Json = Record<string, unknown>;

let products: Json[];
let categories: Json[];
let pools: Json[];
let pricing: Json | null;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/gpu-products" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: products, categories }) });
    }
    if (url === "/api/admin/pool-settings") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { availablePools: pools } }) });
    }
    if (url === "/api/admin/pricing" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ pricing }) });
    }
    if (url === "/api/admin/pricing" && method === "PUT") {
      return Promise.resolve({ ok: true, json: async () => ({ pricing: { storagePricePerGBHourCents: 0.01 } }) });
    }
    if (url === "/api/admin/stripe-products") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
    }
    // POST product/category CRUD
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleProduct = (over: Json = {}): Json => ({
  id: "prod-1",
  name: "RTX 6000 Ada",
  description: "Workstation GPU",
  billingType: "hourly",
  pricePerHourCents: 200,
  pricePerMonthCents: null,
  stripeProductId: null,
  stripePriceId: null,
  poolIds: [1],
  displayOrder: 0,
  active: true,
  featured: false,
  badgeText: null,
  vramGb: 48,
  cudaCores: 18176,
  gpuFamily: "RTX 6000",
  serviceId: "svc-1",
  categoryIds: ["cat-1"],
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  products = [];
  categories = [];
  pools = [{ id: 1, name: "alpha-pool", gpuModel: "RTX 6000" }];
  pricing = { storagePricePerGBHourCents: 0.01, updatedAt: "2026-01-01T00:00:00Z", updatedBy: "admin" };
});

describe("ProductsTab", () => {
  it("shows a loading spinner before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<ProductsTab />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("fetches products, pools and pricing on mount", async () => {
    const fetchMock = makeFetch();
    render(<ProductsTab />);
    await screen.findByText("GPU Products");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/gpu-products");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pool-settings");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pricing");
  });

  it("renders the products table empty state when there are none", async () => {
    makeFetch();
    render(<ProductsTab />);
    expect(await screen.findByText(/no products yet/i)).toBeInTheDocument();
  });

  it("renders a product row with name and hourly pricing", async () => {
    products = [sampleProduct()];
    categories = [{ id: "cat-1", name: "H100", slug: "h100", description: "", displayOrder: 0, active: true, scenarioId: "s" }];
    makeFetch();
    render(<ProductsTab />);
    expect(await screen.findByText("RTX 6000 Ada")).toBeInTheDocument();
    expect(screen.getByText("$2.00/hr")).toBeInTheDocument();
    expect(screen.getByText("Hourly")).toBeInTheDocument();
  });

  it("prefills the storage-pricing input from the API (cents to dollars)", async () => {
    makeFetch();
    render(<ProductsTab />);
    await screen.findByText(/storage pricing/i);
    // 0.01 cents / 100 = 0.0001 → 8dp "0.00010000"
    expect(screen.getByDisplayValue("0.00010000")).toBeInTheDocument();
  });

  it("PUTs storage pricing when Save is clicked", async () => {
    const fetchMock = makeFetch();
    render(<ProductsTab />);
    await screen.findByText(/storage pricing/i);

    const input = screen.getByDisplayValue("0.00010000");
    fireEvent.change(input, { target: { value: "0.00020000" } });
    // The storage Save button is the first "Save" in that section.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pricing" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string)).toHaveProperty("storagePricePerGBHourCents");
    });
  });

  it("renders the empty category state when there are none", async () => {
    makeFetch();
    render(<ProductsTab />);
    expect(await screen.findByText(/no categories yet/i)).toBeInTheDocument();
  });

  it("opens the category modal and POSTs action=create-category", async () => {
    const fetchMock = makeFetch();
    render(<ProductsTab />);
    await screen.findByText("GPU Categories");

    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    expect(screen.getByRole("heading", { name: /create category/i })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/e\.g\., H100/i), { target: { value: "B200" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/gpu-products" && c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "create-category"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).name).toBe("B200");
    });
  });

  it("opens the create-product modal and POSTs action=create", async () => {
    const fetchMock = makeFetch();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<ProductsTab />);
    await screen.findByText("GPU Products");

    fireEvent.click(screen.getByRole("button", { name: /add product/i }));
    expect(screen.getByRole("heading", { name: /create product/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/RTX 6000 Ada/i), { target: { value: "L40S" } });
    fireEvent.change(screen.getByPlaceholderText(/2\.00/), { target: { value: "1.50" } });
    // serviceId is required; the picker is stubbed, so save hits the validation
    // guard. Click the submit button (distinct from the modal heading text).
    fireEvent.click(screen.getByRole("button", { name: /^create product$/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("HAI Service is required"));
    expect(
      fetchMock.mock.calls.some(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "create"
      )
    ).toBe(false);
    alertSpy.mockRestore();
  });

  it("confirms and POSTs action=delete when a product is deleted", async () => {
    products = [sampleProduct()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProductsTab />);
    await screen.findByText("RTX 6000 Ada");

    // The delete button is the trash icon (title="Delete").
    fireEvent.click(screen.getByTitle("Delete"));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "delete"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).id).toBe("prod-1");
    });
    confirmSpy.mockRestore();
  });

  it("opens the edit-product modal prefilled from the row", async () => {
    products = [sampleProduct()];
    makeFetch();
    render(<ProductsTab />);
    await screen.findByText("RTX 6000 Ada");

    fireEvent.click(screen.getByTitle("Edit"));
    expect(screen.getByRole("heading", { name: /edit product/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("RTX 6000 Ada")).toBeInTheDocument();
  });
});
