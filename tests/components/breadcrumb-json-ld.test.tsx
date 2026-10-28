// @vitest-environment jsdom
//
// PA-287: unit coverage for BreadcrumbJsonLd (src/components/BreadcrumbJsonLd.tsx).
// Emits a schema.org BreadcrumbList as a JSON-LD <script>. Relative hrefs are
// prefixed with the app URL; absolute (http) hrefs pass through unchanged.
//
// getAppUrl is mocked so the absolute-URL expectations are stable regardless
// of edition/env resolution.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/branding", () => ({
  getAppUrl: () => "https://app.example.com",
}));

import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

function renderJsonLd(items: { name: string; href: string }[]) {
  const { container } = render(<BreadcrumbJsonLd items={items} />);
  const script = container.querySelector(
    'script[type="application/ld+json"]',
  );
  return {
    script,
    parsed: JSON.parse(script?.textContent ?? "{}"),
  };
}

describe("BreadcrumbJsonLd", () => {
  it("renders a JSON-LD script tag", () => {
    const { script } = renderJsonLd([{ name: "Home", href: "/" }]);
    expect(script).not.toBeNull();
  });

  it("declares the BreadcrumbList schema", () => {
    const { parsed } = renderJsonLd([{ name: "Home", href: "/" }]);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("BreadcrumbList");
  });

  it("assigns 1-based positions in order", () => {
    const { parsed } = renderJsonLd([
      { name: "Home", href: "/" },
      { name: "Docs", href: "/docs" },
      { name: "API", href: "/docs/api" },
    ]);
    expect(parsed.itemListElement).toHaveLength(3);
    expect(parsed.itemListElement[0].position).toBe(1);
    expect(parsed.itemListElement[1].position).toBe(2);
    expect(parsed.itemListElement[2].position).toBe(3);
    expect(parsed.itemListElement.map((e: { name: string }) => e.name)).toEqual([
      "Home",
      "Docs",
      "API",
    ]);
  });

  it("prefixes relative hrefs with the app URL", () => {
    const { parsed } = renderJsonLd([{ name: "Docs", href: "/docs" }]);
    expect(parsed.itemListElement[0].item).toBe(
      "https://app.example.com/docs",
    );
  });

  it("leaves absolute (http) hrefs untouched", () => {
    const { parsed } = renderJsonLd([
      { name: "External", href: "https://other.example.com/page" },
    ]);
    expect(parsed.itemListElement[0].item).toBe(
      "https://other.example.com/page",
    );
  });

  it("marks each entry as a ListItem", () => {
    const { parsed } = renderJsonLd([{ name: "Home", href: "/" }]);
    expect(parsed.itemListElement[0]["@type"]).toBe("ListItem");
  });

  it("emits an empty itemListElement for no items", () => {
    const { parsed } = renderJsonLd([]);
    expect(parsed.itemListElement).toEqual([]);
  });
});
