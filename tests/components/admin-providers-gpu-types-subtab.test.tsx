// @vitest-environment jsdom
//
// PA-288: Unit coverage for the admin providers GpuTypesSubTab — a prop-driven
// GPU-type table with an Add/Edit modal. The list itself is fed by props; the
// embedded GpuTypeModal POSTs/PUTs to /api/admin/providers/gpu-types on save.
// We stub fetch to assert the modal fires the right method/URL/body and that
// the toggle/refresh callbacks fire.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GpuTypesSubTab } from "@/app/admin/components/providers/GpuTypesSubTab";
import type { GpuType } from "@/app/admin/types";

function makeGpu(overrides: Partial<GpuType> = {}): GpuType {
  return {
    id: "gpu_1",
    name: "NVIDIA H100 80GB",
    shortName: "H100",
    manufacturer: "NVIDIA",
    matchPatterns: ["H100"],
    defaultProviderRateCents: 100,
    defaultCustomerRateCents: 150,
    defaultTermsType: "fixed",
    defaultRevenueSharePercent: 70,
    payoutModelChoice: "fixed_only",
    acceptingSubmissions: true,
    displayOrder: 0,
    minVramGb: 80,
    ...overrides,
  };
}

function baseProps() {
  return {
    gpuTypes: [] as GpuType[],
    actionLoading: null as string | null,
    onToggleSubmissions: vi.fn(),
    onRefresh: vi.fn(),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("GpuTypesSubTab — table", () => {
  it("renders the empty state when no GPU types are configured", () => {
    render(<GpuTypesSubTab {...baseProps()} />);
    expect(screen.getByText(/no gpu types configured/i)).toBeInTheDocument();
  });

  it("renders a GPU row with rates, payout label and status", () => {
    render(<GpuTypesSubTab {...baseProps()} gpuTypes={[makeGpu()]} />);
    expect(screen.getByText("NVIDIA H100 80GB")).toBeInTheDocument();
    expect(screen.getByText(/H100 • NVIDIA/)).toBeInTheDocument();
    expect(screen.getByText("$1.00/hr")).toBeInTheDocument();
    expect(screen.getByText("$1.50/hr")).toBeInTheDocument();
    expect(screen.getByText("Fixed Rate Only")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders Paused status and a Resume button for a paused GPU type", () => {
    render(
      <GpuTypesSubTab
        {...baseProps()}
        gpuTypes={[makeGpu({ acceptingSubmissions: false })]}
      />,
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("shows the revenue-share line for non-fixed payout models", () => {
    render(
      <GpuTypesSubTab
        {...baseProps()}
        gpuTypes={[makeGpu({ payoutModelChoice: "revenue_share_only", defaultRevenueSharePercent: 65 })]}
      />,
    );
    expect(screen.getByText("Revenue Share Only")).toBeInTheDocument();
    expect(screen.getByText(/65% rev share/)).toBeInTheDocument();
  });

  it("fires onToggleSubmissions with the GPU when Pause is clicked", () => {
    const props = baseProps();
    render(<GpuTypesSubTab {...props} gpuTypes={[makeGpu()]} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(props.onToggleSubmissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gpu_1" }),
    );
  });

  it("disables the toggle button while actionLoading matches the row id", () => {
    render(
      <GpuTypesSubTab {...baseProps()} gpuTypes={[makeGpu()]} actionLoading="gpu_1" />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeDisabled();
  });
});

describe("GpuTypesSubTab — add/edit modal", () => {
  it("opens the Add modal in create mode", () => {
    render(<GpuTypesSubTab {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /add gpu type/i }));
    expect(screen.getByRole("heading", { name: /add gpu type/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeInTheDocument();
  });

  it("opens the Edit modal pre-filled for an existing GPU type", () => {
    render(<GpuTypesSubTab {...baseProps()} gpuTypes={[makeGpu()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("heading", { name: /edit gpu type/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("NVIDIA H100 80GB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^update$/i })).toBeInTheDocument();
  });

  it("POSTs a new GPU type and refreshes on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const props = baseProps();
    render(<GpuTypesSubTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /add gpu type/i }));

    fireEvent.change(screen.getByPlaceholderText("NVIDIA H100 80GB"), {
      target: { value: "Test GPU" },
    });
    fireEvent.change(screen.getByPlaceholderText("H100"), {
      target: { value: "TG1" },
    });
    fireEvent.change(screen.getByPlaceholderText("H100, A100"), {
      target: { value: "TG1, TG2" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/providers/gpu-types");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Test GPU");
    expect(body.matchPatterns).toEqual(["TG1", "TG2"]);
    // fixed_only -> revenue share nulled out.
    expect(body.defaultRevenueSharePercent).toBeNull();

    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1));
  });

  it("PUTs with the id when editing an existing GPU type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<GpuTypesSubTab {...baseProps()} gpuTypes={[makeGpu()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^update$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/providers/gpu-types");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).id).toBe("gpu_1");
  });

  it("alerts and keeps the modal open when the save fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "Boom" }) });
    vi.stubGlobal("fetch", fetchMock);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<GpuTypesSubTab {...baseProps()} gpuTypes={[makeGpu()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^update$/i }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Boom"));
    // Modal still mounted.
    expect(screen.getByRole("heading", { name: /edit gpu type/i })).toBeInTheDocument();
    alertSpy.mockRestore();
  });

  it("reveals the revenue-share field when a non-fixed payout model is chosen", () => {
    render(<GpuTypesSubTab {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /add gpu type/i }));
    // Fixed by default -> no rev share field.
    expect(screen.queryByText(/default revenue share %/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue(/fixed rate only/i), {
      target: { value: "provider_choice" },
    });
    expect(screen.getByText(/default revenue share %/i)).toBeInTheDocument();
  });

  it("closes the modal on Cancel", () => {
    render(<GpuTypesSubTab {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /add gpu type/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { name: /add gpu type/i })).not.toBeInTheDocument();
  });
});
