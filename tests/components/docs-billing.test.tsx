// @vitest-environment jsdom
//
// PA-287: BillingDoc is a static documentation panel rendered in the dashboard
// docs tab. These tests pin the meaningful, stable content the doc renders:
// section headings, the two billing models, concrete pricing strings, the
// in-page table-of-contents anchors, and the FAQ.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { BillingDoc } from "@/app/dashboard/components/docs/BillingDoc";

describe("BillingDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<BillingDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/two ways to rent gpus/i),
    ).toBeInTheDocument();
  });

  it("documents both billing models as section headings", () => {
    render(<BillingDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /two ways to rent a gpu/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /hourly \(pay-as-you-go\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /monthly subscription/i }),
    ).toBeInTheDocument();
  });

  it("renders an in-page table of contents linking to each section anchor", () => {
    render(<BillingDoc />);
    expect(
      screen.getByRole("link", { name: /two ways to rent a gpu/i }),
    ).toHaveAttribute("href", "#two-billing-models");
    expect(
      screen.getByRole("link", { name: /gpu pricing/i }),
    ).toHaveAttribute("href", "#gpu-pricing");
    expect(
      screen.getByRole("link", { name: /^faq$/i }),
    ).toHaveAttribute("href", "#faq");
  });

  it("states the concrete monthly subscription price and 30-minute billing interval", () => {
    render(<BillingDoc />);
    // $299/mo appears in several places (cards, table, FAQ) — assert presence.
    expect(screen.getAllByText(/\$299\/mo/).length).toBeGreaterThan(0);
    // "30-minute" appears in both the option card and the hourly section.
    expect(screen.getAllByText(/30-minute/i).length).toBeGreaterThan(0);
  });

  it("lists the GPU pricing rows for the RTX PRO 6000 and B200", () => {
    render(<BillingDoc />);
    const pricingHeading = screen.getByRole("heading", {
      level: 2,
      name: /gpu pricing/i,
    });
    // RTX PRO 6000 Blackwell row with its hourly rate and VRAM.
    expect(screen.getByText("RTX PRO 6000 Blackwell")).toBeInTheDocument();
    expect(screen.getByText("96 GB GDDR7")).toBeInTheDocument();
    expect(screen.getByText("NVIDIA B200")).toBeInTheDocument();
    expect(screen.getByText("180 GB HBM3e")).toBeInTheDocument();
    expect(pricingHeading).toBeInTheDocument();
  });

  it("renders the persistent storage price", () => {
    render(<BillingDoc />);
    expect(screen.getByText(/\$0\.10\/GB\/month/)).toBeInTheDocument();
  });

  it("answers the wallet-independence question in the FAQ", () => {
    render(<BillingDoc />);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: /is the monthly subscription tied to my wallet/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows the worked hourly billing example", () => {
    render(<BillingDoc />);
    const example = screen.getByText(/launch an rtx pro 6000 at \$0\.66\/hr/i);
    expect(example).toBeInTheDocument();
    expect(within(example).getByText("$0.495")).toBeInTheDocument();
  });
});
