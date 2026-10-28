// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): OnboardingChecklist — derives 4 setup steps from
// props (wallet balance, GPU running, pool subscriptions) + localStorage
// (explored inventory, dismissed). Hidden when all complete or dismissed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/branding-client", () => ({
  getBrandName: () => "TestCloud",
}));

import { OnboardingChecklist } from "@/app/dashboard/components/OnboardingChecklist";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    walletBalance: 0,
    hasLaunchedGpu: false,
    hasPoolSubscriptions: false,
    onAddFunds: vi.fn(),
    onExploreGPUs: vi.fn(),
    onLaunchGpu: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("OnboardingChecklist", () => {
  it("renders the checklist with the brand name when not dismissed", () => {
    render(<OnboardingChecklist {...makeProps()} />);
    expect(screen.getByText(/get started with TestCloud/i)).toBeInTheDocument();
    expect(screen.getByText("Add funds to your wallet")).toBeInTheDocument();
  });

  it("shows the completion count (account is always complete)", () => {
    render(<OnboardingChecklist {...makeProps()} />);
    // Only the "Create account" step is complete out of 4.
    expect(screen.getByText("1 of 4 complete")).toBeInTheDocument();
  });

  it("marks the funds step complete and shows the balance when wallet > 0", () => {
    render(<OnboardingChecklist {...makeProps({ walletBalance: 2500 })} />);
    expect(screen.getByText("$25.00 balance")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 complete")).toBeInTheDocument();
  });

  it("returns null (renders nothing) when all steps are complete", () => {
    localStorage.setItem("packet_explored_inventory", "true");
    const { container } = render(
      <OnboardingChecklist
        {...makeProps({ walletBalance: 1000, hasLaunchedGpu: true, hasPoolSubscriptions: true })}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("returns null when previously dismissed via localStorage", () => {
    localStorage.setItem("packet_onboarding_dismissed", "true");
    const { container } = render(<OnboardingChecklist {...makeProps()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses the checklist and persists the flag", () => {
    render(<OnboardingChecklist {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(localStorage.getItem("packet_onboarding_dismissed")).toBe("true");
    expect(screen.queryByText(/get started with/i)).not.toBeInTheDocument();
  });

  it("fires onExploreGPUs and marks explored when the next-step CTA is clicked", () => {
    const onExploreGPUs = vi.fn();
    render(<OnboardingChecklist {...makeProps({ onExploreGPUs })} />);
    // The first incomplete step is "Explore GPU inventory"; its CTA is "View GPUs".
    fireEvent.click(screen.getByText("View GPUs"));
    expect(onExploreGPUs).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("packet_explored_inventory")).toBe("true");
  });

  it("treats a launched GPU as completing the explore + gpu steps", () => {
    render(<OnboardingChecklist {...makeProps({ hasLaunchedGpu: true })} />);
    // account + explore + gpu complete (3 of 4); only funds remains.
    expect(screen.getByText("3 of 4 complete")).toBeInTheDocument();
    expect(screen.getByText("Add Funds")).toBeInTheDocument();
  });

  it("invokes onAddFunds for the funds CTA when it is the next step", () => {
    const onAddFunds = vi.fn();
    // explored already done so the next incomplete step is funds.
    localStorage.setItem("packet_explored_inventory", "true");
    render(<OnboardingChecklist {...makeProps({ onAddFunds })} />);
    fireEvent.click(screen.getByText("Add Funds"));
    expect(onAddFunds).toHaveBeenCalledTimes(1);
  });
});

/*
 * Step 4 is the one the customer reported. Its CTA used to call
 * onNavigateToTab("dashboard") — the tab the checklist already renders on — so
 * clicking "Launch GPU" did nothing at all, and completion was read off a LIVE
 * running count, so stopping the pod you had just launched un-completed it.
 */
describe("OnboardingChecklist — the launch step", () => {
  it("opens the launch flow when the Launch GPU CTA is clicked", () => {
    const onLaunchGpu = vi.fn();
    // Explored + funded, so the launch step is the next incomplete one.
    localStorage.setItem("packet_explored_inventory", "true");
    render(<OnboardingChecklist {...makeProps({ walletBalance: 5000, onLaunchGpu })} />);

    fireEvent.click(screen.getByText("Launch GPU"));
    expect(onLaunchGpu).toHaveBeenCalledTimes(1);
  });

  it("stays complete for a GPU that has been launched but is not running now", () => {
    // hasLaunchedGpu is a milestone, not a gauge: a stopped or starting pod
    // still means this account has launched one.
    render(<OnboardingChecklist {...makeProps({ hasLaunchedGpu: true })} />);

    expect(screen.getByText("3 of 4 complete")).toBeInTheDocument();
    expect(screen.queryByText("Launch GPU")).not.toBeInTheDocument();
  });
});
