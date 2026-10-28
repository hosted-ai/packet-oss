// @vitest-environment jsdom
//
// PA-287: ServiceExposureDoc is a static documentation panel for exposing pod
// ports to the internet. These tests pin the title, the common-use-case ports,
// the step-by-step expose flow, the 0.0.0.0 binding guidance, and the SSH
// port-forwarding alternative.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ServiceExposureDoc } from "@/app/dashboard/components/docs/ServiceExposureDoc";

describe("ServiceExposureDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<ServiceExposureDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    // This phrase appears in both the lead and the overview paragraph.
    expect(
      screen.getAllByText(/expose network ports from your gpu instances/i).length,
    ).toBeGreaterThan(0);
  });

  it("documents common use cases with their ports", () => {
    render(<ServiceExposureDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /vllm api server/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /jupyter notebook/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /tensorboard/i }),
    ).toBeInTheDocument();
    // TensorBoard's documented port — rendered as "<strong>Port</strong>: 6006",
    // so the "6006" lives in a ": 6006" text node; match with a regex.
    expect(screen.getByText(/6006/)).toBeInTheDocument();
  });

  it("walks through the four-step expose flow", () => {
    render(<ServiceExposureDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /step 1: start your application/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /step 4: access your service/i }),
    ).toBeInTheDocument();
  });

  it("stresses binding to 0.0.0.0 rather than localhost", () => {
    render(<ServiceExposureDoc />);
    expect(
      screen.getByText(/wrong - only localhost can connect/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/correct - external traffic can connect/i),
    ).toBeInTheDocument();
  });

  it("documents deleting an exposed service and the immediate access loss", () => {
    render(<ServiceExposureDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /deleting a service/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/external clients will lose access immediately/i),
    ).toBeInTheDocument();
  });

  it("offers SSH port forwarding as an alternative", () => {
    render(<ServiceExposureDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /alternative: ssh port forwarding/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Forward remote port 8000 to local port 8000/i),
    ).toBeInTheDocument();
  });
});
