// @vitest-environment jsdom
//
// PA-287: unit coverage for BrandStyles (src/components/BrandStyles.tsx). A
// server component that emits a <style> block of :root CSS custom properties
// derived from the branding helpers, including hex->rgb channel splits used
// for alpha compositing (--primary-r/g/b, --accent-r/g/b).
//
// The branding module is mocked so the test is independent of edition/env
// resolution and can pin exact colors → exact emitted CSS.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/branding", () => ({
  getPrimaryColor: () => "#1a4fff",
  getAccentColor: () => "#18b6a8",
  getBackgroundColor: () => "#f7f8fb",
  getTextColor: () => "#0b0f1c",
}));

import { BrandStyles } from "@/components/BrandStyles";

function renderStyleText() {
  const { container } = render(<BrandStyles />);
  const style = container.querySelector("style");
  return style?.textContent ?? "";
}

describe("BrandStyles", () => {
  it("renders a <style> element", () => {
    const { container } = render(<BrandStyles />);
    expect(container.querySelector("style")).not.toBeNull();
  });

  it("emits the primary color as --blue and --blue-dark", () => {
    const css = renderStyleText();
    expect(css).toContain("--blue: #1a4fff;");
    expect(css).toContain("--blue-dark: #1a4fff;");
  });

  it("emits the accent color as --teal", () => {
    expect(renderStyleText()).toContain("--teal: #18b6a8;");
  });

  it("emits background and foreground custom properties", () => {
    const css = renderStyleText();
    expect(css).toContain("--background: #f7f8fb;");
    expect(css).toContain("--foreground: #0b0f1c;");
  });

  it("splits the primary hex into r/g/b channels", () => {
    // #1a4fff => 26, 79, 255
    const css = renderStyleText();
    expect(css).toContain("--primary-r: 26;");
    expect(css).toContain("--primary-g: 79;");
    expect(css).toContain("--primary-b: 255;");
  });

  it("splits the accent hex into r/g/b channels", () => {
    // #18b6a8 => 24, 182, 168
    const css = renderStyleText();
    expect(css).toContain("--accent-r: 24;");
    expect(css).toContain("--accent-g: 182;");
    expect(css).toContain("--accent-b: 168;");
  });
});

describe("BrandStyles — short hex expansion", () => {
  // A separate module mock for the 3-digit hex branch in hexToRgb.
  it("expands a 3-digit hex color into full r/g/b channels", async () => {
    vi.resetModules();
    vi.doMock("@/lib/branding", () => ({
      getPrimaryColor: () => "#f00", // => 255, 0, 0
      getAccentColor: () => "#0f0", // => 0, 255, 0
      getBackgroundColor: () => "#000",
      getTextColor: () => "#fff",
    }));

    const { BrandStyles: FreshBrandStyles } = await import(
      "@/components/BrandStyles"
    );
    const { container } = render(<FreshBrandStyles />);
    const css = container.querySelector("style")?.textContent ?? "";

    expect(css).toContain("--primary-r: 255;");
    expect(css).toContain("--primary-g: 0;");
    expect(css).toContain("--primary-b: 0;");
    expect(css).toContain("--accent-g: 255;");

    vi.doUnmock("@/lib/branding");
    vi.resetModules();
  });
});
