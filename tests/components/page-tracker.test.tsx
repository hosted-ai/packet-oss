// @vitest-environment jsdom
//
// PageTracker is a fire-and-forget client component: it renders nothing and,
// on mount + on every pathname change, captures UTM params and records an
// anonymous page view via the @/lib/tracker + @/lib/utm boundaries.
//
// We mock both boundaries and the next/navigation usePathname hook so we can
// drive the path and assert the side-effects fire with the right cadence.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const captureUtm = vi.fn();
const trackPageView = vi.fn();

vi.mock("@/lib/utm", () => ({
  captureUtm: () => captureUtm(),
}));
vi.mock("@/lib/tracker", () => ({
  trackPageView: () => trackPageView(),
}));

// usePathname is read at render time; expose a mutable holder so each test can
// control the value before rendering / re-rendering.
let currentPath = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

import PageTracker from "@/components/PageTracker";

beforeEach(() => {
  currentPath = "/dashboard";
  captureUtm.mockClear();
  trackPageView.mockClear();
});

describe("PageTracker", () => {
  it("renders nothing (null)", () => {
    const { container } = render(<PageTracker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("captures UTM and records a page view on mount", () => {
    render(<PageTracker />);
    expect(captureUtm).toHaveBeenCalledTimes(1);
    expect(trackPageView).toHaveBeenCalledTimes(1);
  });

  it("re-fires both side-effects when the pathname changes", () => {
    const { rerender } = render(<PageTracker />);
    expect(trackPageView).toHaveBeenCalledTimes(1);

    currentPath = "/dashboard/billing";
    rerender(<PageTracker />);

    expect(captureUtm).toHaveBeenCalledTimes(2);
    expect(trackPageView).toHaveBeenCalledTimes(2);
  });

  it("does not re-fire when re-rendered with the same pathname", () => {
    const { rerender } = render(<PageTracker />);
    rerender(<PageTracker />);
    // useEffect deps unchanged → only the initial run.
    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(captureUtm).toHaveBeenCalledTimes(1);
  });
});
