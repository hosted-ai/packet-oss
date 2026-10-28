// @vitest-environment jsdom
//
// PA-288: GPUPicker (src/components/GPUPicker.tsx) — the shared 2-step GPU
// selection control used by LaunchGPUModal and the HuggingFace deploy modal.
// Categories + products arrive as props; the component only fetches
// `/api/instances/category-check?categoryId=` (on category selection) to learn
// which products/regions are actually compatible/available, then drives an
// onSelectionChange callback whenever the selection changes.
//
// Two layouts: `compact` (dropdowns, for embedded HF modal) and full (cards).
// We exercise both. fetch is stubbed per-test and reset in beforeEach.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  GPUPicker,
  type GPUPickerCategory,
  type GPUPickerProduct,
} from "@/components/GPUPicker";

// ── Fixtures ────────────────────────────────────────────────────────────────

const REGION_NYC = { id: 1, region_name: "us-nyc-1", city: "New York", country: "USA", country_code: "us" };
const REGION_LON = { id: 2, region_name: "eu-lon-1", city: "London", country: "UK", country_code: "gb" };

function makeProduct(over: Partial<GPUPickerProduct> = {}): GPUPickerProduct {
  return {
    id: "prod-a100",
    name: "A100",
    description: "Ampere flagship",
    pricePerHourCents: 250,
    serviceId: "svc-a100",
    displayOrder: 0,
    vramGb: 80,
    categoryIds: ["cat-data"],
    available: null,
    ...over,
  };
}

function makeCategory(over: Partial<GPUPickerCategory> = {}): GPUPickerCategory {
  return {
    id: "cat-data",
    name: "Data Center",
    slug: "data-center",
    description: "Datacenter-class GPUs",
    displayOrder: 0,
    icon: null,
    scenarioConfigured: true,
    products: [makeProduct()],
    ...over,
  };
}

function stubCategoryCheck(body: {
  categoryId?: string;
  compatibleServiceIds?: string[];
  serviceRegions?: Record<string, typeof REGION_NYC[]>;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      categoryId: body.categoryId ?? "cat-data",
      compatibleServiceIds: body.compatibleServiceIds ?? [],
      serviceRegions: body.serviceRegions ?? {},
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ── Full (card) layout ────────────────────────────────────────────────────

describe("GPUPicker — full layout (cards)", () => {
  it("renders one category card per category and no products until a category is picked", () => {
    stubCategoryCheck({});
    render(
      <GPUPicker
        token="t"
        categories={[makeCategory({ name: "Data Center" }), makeCategory({ id: "cat-ws", name: "Workstation", products: [] })]}
        products={[makeProduct()]}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Data Center/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workstation/ })).toBeInTheDocument();
    // Product card not shown pre-selection.
    expect(screen.queryByText("Select a GPU")).not.toBeInTheDocument();
  });

  it("fires the category-check fetch with the categoryId when a category is selected", async () => {
    const fetchMock = stubCategoryCheck({ compatibleServiceIds: ["svc-a100"], serviceRegions: { "svc-a100": [REGION_NYC] } });
    render(
      <GPUPicker token="tok-123" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/category-check?categoryId=cat-data");
    expect(opts.headers.Authorization).toBe("Bearer tok-123");
  });

  it("renders the product as available and auto-selects it when the category-check marks its service compatible", async () => {
    const onChange = vi.fn();
    stubCategoryCheck({ compatibleServiceIds: ["svc-a100"], serviceRegions: { "svc-a100": [REGION_NYC] } });
    render(<GPUPicker token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));

    // Product card surfaces with its price; A100 auto-selected -> region shown.
    await waitFor(() => expect(screen.getByText("Select a GPU")).toBeInTheDocument());
    expect(screen.getByText("$2.50")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("New York")).toBeInTheDocument());

    // onSelectionChange eventually reports the selected, available product.
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)![0];
      expect(last.product?.id).toBe("prod-a100");
      expect(last.productAvailable).toBe(true);
      expect(last.region?.id).toBe(1);
    });
  });

  it("marks a product Unavailable when its service is not in the compatible set", async () => {
    stubCategoryCheck({ compatibleServiceIds: [], serviceRegions: {} });
    render(<GPUPicker token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument());
    // The product button is disabled when unavailable.
    const card = screen.getByText("A100").closest("button");
    expect(card).toBeDisabled();
  });

  it("disables a category whose scenario is not configured (pending setup)", () => {
    stubCategoryCheck({});
    render(
      <GPUPicker
        token="t"
        categories={[makeCategory({ scenarioConfigured: false })]}
        products={[makeProduct()]}
        onSelectionChange={() => {}}
      />,
    );
    const btn = screen.getByText("Data Center").closest("button");
    expect(btn).toBeDisabled();
    expect(screen.getByText("Pending setup")).toBeInTheDocument();
  });

  it("offers a back link that returns to the category list", async () => {
    stubCategoryCheck({ compatibleServiceIds: ["svc-a100"], serviceRegions: { "svc-a100": [REGION_NYC] } });
    render(<GPUPicker token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
    await waitFor(() => expect(screen.getByText("Select a GPU")).toBeInTheDocument());

    // The back link is a button whose label is the category name.
    const back = screen.getByRole("button", { name: "Data Center" });
    fireEvent.click(back);
    // We are back to the category picker (the "Select GPU Type" label).
    expect(screen.getByText("Select GPU Type")).toBeInTheDocument();
  });

  it("renders a region picker with multiple regions and switches the selected region on click", async () => {
    const onChange = vi.fn();
    stubCategoryCheck({
      compatibleServiceIds: ["svc-a100"],
      serviceRegions: { "svc-a100": [REGION_NYC, REGION_LON] },
    });
    render(<GPUPicker token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));

    await waitFor(() => expect(screen.getByText("London")).toBeInTheDocument());
    fireEvent.click(screen.getByText("London").closest("button")!);

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)![0];
      expect(last.region?.id).toBe(2);
    });
  });

  it("shows 'No GPUs available in this category' when the category has no products", async () => {
    stubCategoryCheck({ compatibleServiceIds: [], serviceRegions: {} });
    render(
      <GPUPicker
        token="t"
        categories={[makeCategory({ products: [] })]}
        products={[]}
        onSelectionChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
    await waitFor(() => expect(screen.getByText("No GPUs available in this category.")).toBeInTheDocument());
  });

  it("swallows a category-check fetch rejection without crashing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    render(<GPUPicker token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Data Center/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Loading clears; the category view still renders its back link.
    await waitFor(() => expect(screen.getByRole("button", { name: "Data Center" })).toBeInTheDocument());
  });
});

// ── Compact (dropdown) layout ───────────────────────────────────────────────

describe("GPUPicker — compact layout (dropdowns)", () => {
  it("renders a GPU-type select and triggers category-check when a type is chosen", async () => {
    const fetchMock = stubCategoryCheck({
      compatibleServiceIds: ["svc-a100"],
      serviceRegions: { "svc-a100": [REGION_NYC] },
    });
    render(
      <GPUPicker compact token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={() => {}} />,
    );
    // GPU Type label present; the first <select> is the type dropdown.
    expect(screen.getByText("GPU Type")).toBeInTheDocument();
    const typeSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(typeSelect, { target: { value: "Data Center" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/instances/category-check?categoryId=cat-data");
  });

  it("renders the single region as text (not a dropdown) when only one region is available", async () => {
    stubCategoryCheck({
      compatibleServiceIds: ["svc-a100"],
      serviceRegions: { "svc-a100": [REGION_NYC] },
    });
    render(
      <GPUPicker compact token="t" categories={[makeCategory()]} products={[makeProduct()]} onSelectionChange={() => {}} />,
    );
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Data Center" } });
    // Single region renders as a "Region:" text line.
    await waitFor(() => expect(screen.getByText(/Region:/)).toBeInTheDocument());
  });
});
