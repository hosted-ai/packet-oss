// @vitest-environment jsdom
//
// PA-287: unit coverage for GeometricHeader
// (src/app/dashboard/components/GeometricHeader.tsx). A purely decorative SVG
// banner with no props. Smoke + structural assertions: it mounts, renders an
// SVG, and includes the generated dot grid (60 dots) and stripe lines (8).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { GeometricHeader } from "@/app/dashboard/components/GeometricHeader";

describe("GeometricHeader", () => {
  it("mounts and renders an svg", () => {
    const { container } = render(<GeometricHeader />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("uses the expected viewBox", () => {
    const { container } = render(<GeometricHeader />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 800 64",
    );
  });

  it("renders the decorative shapes (circles, rects, polygons)", () => {
    const { container } = render(<GeometricHeader />);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("polygon").length).toBe(2);
  });

  it("generates the 6x10 dot grid (60 dotted circles)", () => {
    const { container } = render(<GeometricHeader />);
    // 2 standalone circles (coral + black) + 60 grid dots = 62 circles total.
    expect(container.querySelectorAll("circle").length).toBe(62);
  });

  it("generates the 8 stripe lines", () => {
    const { container } = render(<GeometricHeader />);
    expect(container.querySelectorAll("line").length).toBe(8);
  });
});
