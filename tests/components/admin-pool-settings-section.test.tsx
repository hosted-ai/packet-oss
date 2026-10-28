// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — PoolSettingsSection.
// Self-fetches /api/admin/pool-settings (defaults + overrides + availablePools),
// renders a defaults form (PUT on save) + an overrides table with an add/edit
// modal (POST create / PUT update) and delete (DELETE with confirm). Pins the
// loading skeleton, defaults prefill + save payload, empty/populated overrides,
// the modal create/edit flows, and the delete confirmation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PoolSettingsSection } from "@/app/admin/components/PoolSettingsSection";

type Json = Record<string, unknown>;

let dataPayload: Json;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/pool-settings" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: dataPayload }) });
    }
    // PUT defaults / POST create / PUT update / DELETE
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const basePayload = (overrides: Json[] = []): Json => ({
  defaults: { timeQuantumSec: 90, overcommitRatio: 2, securityMode: "medium" },
  overrides,
  availablePools: [
    { id: 11, name: "Pool A", gpuModel: "H100", hasOverride: false },
    { id: 12, name: "Pool B", gpuModel: "A100", hasOverride: true },
  ],
});

const override = (over: Json = {}): Json => ({
  id: "ov-1",
  gpuaasPoolId: 11,
  poolName: "Pool A",
  timeQuantumSec: 120,
  overcommitRatio: 3,
  securityMode: "high",
  priority: 5,
  maintenance: false,
  notes: "tuned",
  node: null,
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  dataPayload = basePayload();
});

describe("PoolSettingsSection", () => {
  it("shows the loading skeleton before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<PoolSettingsSection />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("fetches pool settings on mount", async () => {
    const fetchMock = makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Default Pool Settings");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pool-settings");
  });

  it("prefills the defaults form from the API", async () => {
    makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Default Pool Settings");
    expect(screen.getByDisplayValue("90")).toBeInTheDocument(); // timeQuantumSec
    expect(screen.getByDisplayValue("2")).toBeInTheDocument(); // overcommitRatio
  });

  it("PUTs the defaults when Save Defaults is submitted", async () => {
    const fetchMock = makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Default Pool Settings");
    fireEvent.change(screen.getByDisplayValue("90"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /save defaults/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pool-settings" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).timeQuantumSec).toBe(120);
    });
  });

  it("renders the empty overrides state", async () => {
    makeFetch();
    render(<PoolSettingsSection />);
    expect(
      await screen.findByText(/no pool-specific overrides configured/i)
    ).toBeInTheDocument();
  });

  it("renders an override row with its computed time/overcommit display", async () => {
    dataPayload = basePayload([override()]);
    makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Pool A");
    expect(screen.getByText("120s")).toBeInTheDocument();
    expect(screen.getByText("3x")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument(); // maintenance false
  });

  it("shows the Maintenance badge for an override in maintenance mode", async () => {
    dataPayload = basePayload([override({ maintenance: true })]);
    makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Pool A");
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
  });

  it("opens the Add Override modal listing only pools without an override", async () => {
    makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Default Pool Settings");
    fireEvent.click(screen.getByRole("button", { name: /\+ add override/i }));
    expect(
      screen.getByRole("heading", { name: /add pool override/i })
    ).toBeInTheDocument();
    // Pool A (no override) is selectable; Pool B (hasOverride) is filtered out.
    expect(screen.getByRole("option", { name: /Pool A/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Pool B/i })).not.toBeInTheDocument();
  });

  it("POSTs a new override on create", async () => {
    const fetchMock = makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Default Pool Settings");
    fireEvent.click(screen.getByRole("button", { name: /\+ add override/i }));

    // The pool <select> is the one containing the "Select a pool..." option.
    const poolSelect = screen
      .getByRole("option", { name: /select a pool/i })
      .closest("select")!;
    fireEvent.change(poolSelect, { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: /create override/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pool-settings" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).gpuaasPoolId).toBe(11);
    });
  });

  it("opens the edit modal prefilled and PUTs to the override id on update", async () => {
    dataPayload = basePayload([override()]);
    const fetchMock = makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Pool A");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("heading", { name: /edit pool override/i })
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("tuned")).toBeInTheDocument(); // notes prefilled

    fireEvent.click(screen.getByRole("button", { name: /update override/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pool-settings/ov-1" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
    });
  });

  it("DELETEs an override after confirmation", async () => {
    dataPayload = basePayload([override()]);
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PoolSettingsSection />);
    await screen.findByText("Pool A");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pool-settings/ov-1" && c[1]?.method === "DELETE"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("does not DELETE when the confirmation is cancelled", async () => {
    dataPayload = basePayload([override()]);
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PoolSettingsSection />);
    await screen.findByText("Pool A");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(
      fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")
    ).toBe(false);
    confirmSpy.mockRestore();
  });

  it("closes the modal when Cancel is clicked", async () => {
    makeFetch();
    render(<PoolSettingsSection />);
    await screen.findByText("Default Pool Settings");
    fireEvent.click(screen.getByRole("button", { name: /\+ add override/i }));
    await screen.findByRole("heading", { name: /add pool override/i });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.queryByRole("heading", { name: /add pool override/i })
    ).not.toBeInTheDocument();
  });
});
