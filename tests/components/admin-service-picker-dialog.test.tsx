// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — ServicePickerDialog.
// Open/closed via the `open` prop (returns null when closed). On open it
// fetches /api/admin/hai-services?per_page=50 (plus optional search/type),
// renders the service list, fires onSelect(id, name) on click, onSelect("","")
// on Clear, onClose on Cancel/backdrop. Pins loading/empty/error + the
// serviceType query-param wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ServicePickerDialog } from "@/app/admin/components/ServicePickerDialog";

type Json = Record<string, unknown>;

let services: Json[];

function makeFetch() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => ({ services }) })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const svc = (over: Json = {}): Json => ({
  id: "svc-12345678-abcd",
  name: "Inference Service",
  description: "An OSS inference service",
  serviceType: "gpu_inference",
  isEnabled: true,
  isSystemDefined: false,
  recipeId: null,
  recipeExecTimingType: null,
  instancesCount: 0,
  ...over,
});

function renderOpen(props: Partial<React.ComponentProps<typeof ServicePickerDialog>> = {}) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(
    <ServicePickerDialog open onClose={onClose} onSelect={onSelect} {...props} />
  );
  return { onClose, onSelect };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  services = [];
});

describe("ServicePickerDialog", () => {
  it("renders nothing when closed", () => {
    makeFetch();
    const { container } = render(
      <ServicePickerDialog open={false} onClose={vi.fn()} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches services with per_page=50 on open", async () => {
    const fetchMock = makeFetch();
    renderOpen();
    await screen.findByText("Select HAI Service");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          (c[0] as string).startsWith("/api/admin/hai-services?per_page=50")
        )
      ).toBe(true);
    });
  });

  it("includes the type query param when serviceType is set", async () => {
    const fetchMock = makeFetch();
    renderOpen({ serviceType: "baremetal_gpu" });
    await screen.findByText("Select HAI Service");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          (c[0] as string).includes("type=baremetal_gpu")
        )
      ).toBe(true);
    });
  });

  it("renders the empty state when no services come back", async () => {
    makeFetch();
    renderOpen();
    expect(await screen.findByText(/no services found in hai/i)).toBeInTheDocument();
  });

  it("renders a service row with name, type and enabled badge", async () => {
    services = [svc()];
    makeFetch();
    renderOpen();
    await screen.findByText("Inference Service");
    expect(screen.getByText("gpu_inference")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("shows the recipe badge when a recipe is linked", async () => {
    services = [svc({ recipeId: 7 })];
    makeFetch();
    renderOpen();
    expect(await screen.findByText("Recipe #7")).toBeInTheDocument();
  });

  it("fires onSelect with the service id and name when a row is clicked", async () => {
    services = [svc()];
    makeFetch();
    const { onSelect } = renderOpen();
    fireEvent.click(await screen.findByText("Inference Service"));
    expect(onSelect).toHaveBeenCalledWith("svc-12345678-abcd", "Inference Service");
  });

  it("marks the current service as Selected", async () => {
    services = [svc()];
    makeFetch();
    renderOpen({ currentServiceId: "svc-12345678-abcd" });
    expect(await screen.findByText("Selected")).toBeInTheDocument();
  });

  it("fires onSelect with empty strings when Clear is clicked", async () => {
    makeFetch();
    const { onSelect } = renderOpen();
    await screen.findByText("Select HAI Service");
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onSelect).toHaveBeenCalledWith("", "");
  });

  it("calls onClose when Cancel is clicked", async () => {
    makeFetch();
    const { onClose } = renderOpen();
    await screen.findByText("Select HAI Service");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the error state when the fetch is not ok", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    renderOpen();
    expect(
      await screen.findByText(/failed to load services from hai/i)
    ).toBeInTheDocument();
  });

  it("shows the search-specific empty message after typing a query with no matches", async () => {
    makeFetch();
    renderOpen();
    await screen.findByText(/no services found in hai/i);
    fireEvent.change(screen.getByPlaceholderText(/search services by name/i), {
      target: { value: "zzz" },
    });
    // debounced fetch fires after 300ms; the search-specific message replaces it
    await waitFor(
      () => expect(screen.getByText(/no services match your search/i)).toBeInTheDocument(),
      { timeout: 1000 }
    );
  });
});
