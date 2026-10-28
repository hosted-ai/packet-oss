// @vitest-environment jsdom
//
// PA-287: GettingStartedDoc is the static onboarding documentation panel. These
// tests pin the title, the numbered launch/connect/work steps, the in-page
// table-of-contents anchors, the internal cross-links to other docs tabs, and
// distinctive prose/snippets. The content was audited against real platform
// behaviour, so the assertions also pin the corrected claims (prepaid-balance
// onboarding, 30-60s provisioning, ~30-minute billing metering, reduced
// stopped rate) and guard that the retired OpenAI gateway doc link is gone.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { GettingStartedDoc } from "@/app/dashboard/components/docs/GettingStartedDoc";

describe("GettingStartedDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<GettingStartedDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/get your first gpu running in minutes/i),
    ).toBeInTheDocument();
  });

  it("documents the three main step headings", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /step 1: launch a gpu/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /step 2: connect to your gpu/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /step 3: start working/i }),
    ).toBeInTheDocument();
  });

  it("links the table of contents to the launch and troubleshooting anchors", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("link", { name: /step 1: launch a gpu/i }),
    ).toHaveAttribute("href", "#launch-gpu");
    expect(
      screen.getByRole("link", { name: /troubleshooting/i }),
    ).toHaveAttribute("href", "#troubleshooting");
  });

  it("cross-links to the other docs tabs via query-param hrefs", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("link", { name: /huggingface docs/i }),
    ).toHaveAttribute("href", "?tab=huggingface");
    expect(
      screen.getByRole("link", { name: /ssh docs/i }),
    ).toHaveAttribute("href", "?tab=ssh");
    expect(
      screen.getByRole("link", { name: /service exposure docs/i }),
    ).toHaveAttribute("href", "?tab=service-exposure");
    // The OpenAI gateway doc is retired — no cross-link to it may remain.
    expect(
      screen.queryByRole("link", { name: /openai gateway docs/i }),
    ).not.toBeInTheDocument();
  });

  it("lists the real platform features in the overview table", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /key features/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Browser Terminal")).toBeInTheDocument();
    expect(
      screen.getByText(/nvidia h100, h200, b200, rtx pro 6000/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/one-click deployment of any huggingface model with vllm/i),
    ).toBeInTheDocument();
  });

  it("highlights the prepaid-balance callout for new users", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("heading", { level: 4, name: /new user\?/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/add funds via the billing tab/i),
    ).toBeInTheDocument();
  });

  it("states the 30-60 second provisioning time", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByText(/typically takes 30-60 seconds/i),
    ).toBeInTheDocument();
  });

  it("shows the SSH connect command example", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByText(/ssh -p 30123 ubuntu@35\.190\.160\.152/),
    ).toBeInTheDocument();
  });

  it("documents the real billing behaviour", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByText(/metered roughly every 30 minutes/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/stopped instances are billed at a reduced rate/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/persistent storage is billed continuously/i),
    ).toBeInTheDocument();
  });

  it("warns that terminate is permanent and volumes keep billing", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("heading", { level: 4, name: /warning: terminate is permanent/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/persistent volumes remain \(and keep billing\)/i),
    ).toBeInTheDocument();
  });

  it("documents common CUDA-not-working troubleshooting", () => {
    render(<GettingStartedDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /cuda not working/i }),
    ).toBeInTheDocument();
  });
});
