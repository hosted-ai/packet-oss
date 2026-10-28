// @vitest-environment jsdom
//
// PA-287: unit coverage for the useBranding hook (src/hooks/useBranding.ts).
// The hook fetches DB-backed branding from /api/branding and starts as null
// (callers fall back to client-side env defaults until it resolves). It also
// strips query strings from local logo/favicon paths, because next/image
// rejects query strings on local paths.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useBranding } from "@/hooks/useBranding";

function stubFetch(fn: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fn);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("useBranding", () => {
  it("returns null on the initial render (before the fetch resolves)", () => {
    // A never-resolving fetch keeps the hook in its pre-load state.
    stubFetch(vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useBranding());

    expect(result.current).toBeNull();
  });

  it("populates config from a successful /api/branding response", async () => {
    const body = {
      brandName: "Test Brand",
      logoUrl: "/custom-logo.png",
      faviconUrl: "/custom-favicon.ico",
      primaryColor: "#123456",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useBranding());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/branding");
    expect(result.current?.brandName).toBe("Test Brand");
    expect(result.current?.logoUrl).toBe("/custom-logo.png");
  });

  it("strips query strings from local logo and favicon paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        logoUrl: "/logo.svg?v=42",
        faviconUrl: "/favicon.ico?cache=abc",
      }),
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useBranding());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.logoUrl).toBe("/logo.svg");
    expect(result.current?.faviconUrl).toBe("/favicon.ico");
  });

  it("leaves remote (http) logo URLs untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        logoUrl: "https://cdn.example.com/logo.png?v=1",
        faviconUrl: "https://cdn.example.com/fav.ico?v=1",
      }),
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useBranding());

    await waitFor(() => expect(result.current).not.toBeNull());
    // cleanLocalUrl only strips paths that start with "/", so remote URLs
    // keep their query strings.
    expect(result.current?.logoUrl).toBe("https://cdn.example.com/logo.png?v=1");
  });

  it("stays null when the response is not ok (falls back to env defaults)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ brandName: "Should Not Apply" }),
    });
    stubFetch(fetchMock);

    const { result } = renderHook(() => useBranding());

    // Give the microtask chain a chance to run; config must remain null.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBeNull();
  });

  it("stays null and swallows a rejected fetch (offline / network error)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    stubFetch(fetchMock);

    const { result } = renderHook(() => useBranding());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
