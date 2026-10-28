// @vitest-environment jsdom
//
// PA-287: unit coverage for ServiceRequiredBanner
// (src/components/ServiceRequiredBanner.tsx). Renders an informational warning
// when a required service is NOT configured, and renders nothing when it is.
// The banner is informational only — it links to Platform Settings.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ServiceRequiredBanner } from "@/components/ServiceRequiredBanner";

describe("ServiceRequiredBanner", () => {
  it("renders nothing when the service is configured", () => {
    const { container } = render(
      <ServiceRequiredBanner
        serviceName="stripe"
        serviceLabel="Stripe"
        configured={true}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the warning when the service is not configured", () => {
    render(
      <ServiceRequiredBanner
        serviceName="stripe"
        serviceLabel="Stripe"
        configured={false}
      />,
    );
    expect(screen.getByText("Stripe is not configured")).toBeInTheDocument();
  });

  it("includes the service label in the explanatory copy", () => {
    render(
      <ServiceRequiredBanner
        serviceName="zammad"
        serviceLabel="Support (Zammad)"
        configured={false}
      />,
    );
    expect(
      screen.getByText(/require Support \(Zammad\) to be set up/i),
    ).toBeInTheDocument();
  });

  it("links to the Platform Settings tab", () => {
    render(
      <ServiceRequiredBanner
        serviceName="stripe"
        serviceLabel="Stripe"
        configured={false}
      />,
    );
    const link = screen.getByRole("link", { name: /Go to Platform Settings/i });
    expect(link).toHaveAttribute("href", "/admin?tab=platform-settings");
  });
});
