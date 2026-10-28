// @vitest-environment jsdom
//
// PA-287: unit coverage for useSecurityHealth (src/hooks/useSecurityHealth.ts).
// Fetches /api/admin/security-health once on mount, exposing { data, loading,
// error }. loading starts true, flips false in the finally; a non-ok response
// throws "HTTP <status>"; a rejected fetch surfaces its message.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useSecurityHealth } from "@/hooks/useSecurityHealth";

function stubFetch(fn: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fn);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE = {
  passwordSet: true,
  twoFactorEnabled: false,
  emailConfigured: true,
  recentFailedLogins: 2,
  score: 3,
  maxScore: 4,
};

describe("useSecurityHealth", () => {
  it("starts in a loading state with no data or error", () => {
    stubFetch(vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useSecurityHealth());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("populates data and clears loading on a successful fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE,
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useSecurityHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/security-health");
    expect(result.current.data).toEqual(SAMPLE);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an 'HTTP <status>' error on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useSecurityHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("HTTP 403");
    expect(result.current.data).toBeNull();
  });

  it("surfaces the error message from a rejected fetch", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection refused"));
    stubFetch(fetchMock);

    const { result } = renderHook(() => useSecurityHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("connection refused");
    expect(result.current.data).toBeNull();
  });

  it("falls back to 'Unknown error' for a non-Error rejection", async () => {
    const fetchMock = vi.fn().mockRejectedValue("just a string");
    stubFetch(fetchMock);

    const { result } = renderHook(() => useSecurityHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });
});
