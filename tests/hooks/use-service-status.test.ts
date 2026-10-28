// @vitest-environment jsdom
//
// PA-287: unit coverage for useServiceStatus (src/hooks/useServiceStatus.ts).
// Fetches /api/admin/platform-settings and projects data.services into a
// { label, configured } map. Exposes an isConfigured(name) helper that
// optimistically returns true while loading or for unknown services.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useServiceStatus } from "@/hooks/useServiceStatus";

function stubFetch(fn: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fn);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

const PLATFORM = {
  services: {
    stripe: { label: "Stripe", configured: true },
    zammad: { label: "Support (Zammad)", configured: false },
  },
};

describe("useServiceStatus", () => {
  it("starts loading with no services", () => {
    stubFetch(vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useServiceStatus());

    expect(result.current.loading).toBe(true);
    expect(result.current.services).toBeNull();
  });

  it("builds the service status map from platform settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => PLATFORM,
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useServiceStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/platform-settings");
    expect(result.current.services).toEqual({
      stripe: { label: "Stripe", configured: true },
      zammad: { label: "Support (Zammad)", configured: false },
    });
  });

  it("isConfigured reflects the fetched status once loaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => PLATFORM,
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useServiceStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isConfigured("stripe")).toBe(true);
    expect(result.current.isConfigured("zammad")).toBe(false);
  });

  it("isConfigured returns true for an unknown service (optimistic default)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => PLATFORM,
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useServiceStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isConfigured("nonexistent")).toBe(true);
  });

  it("isConfigured returns true while still loading", () => {
    stubFetch(vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useServiceStatus());

    // services is still null → assume configured.
    expect(result.current.isConfigured("anything")).toBe(true);
  });

  it("clears loading and leaves services null on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => PLATFORM,
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useServiceStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.services).toBeNull();
  });

  it("clears loading and leaves services null on a fetch rejection", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    stubFetch(fetchMock);

    const { result } = renderHook(() => useServiceStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.services).toBeNull();
  });

  it("leaves services null when the payload has no services key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ somethingElse: true }),
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useServiceStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.services).toBeNull();
  });
});
