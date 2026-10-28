// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. BareMetalInstanceCard is a read-only pods-grid card
// for a unified instance with nature="baremetal". It maps the unified node
// status to a human label, shows the spec line / region / IP / term, an
// optional Manage link, and an SSH access section that only appears once the
// order is provisioned AND online (and a token is present). The heavy
// BareMetalSshAccess child is stubbed to keep this focused on the card.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/dashboard/components/BareMetalSshAccess", () => ({
  BareMetalSshAccess: ({ orderId }: { orderId: string }) => (
    <div data-testid="ssh-access">ssh:{orderId}</div>
  ),
}));

import { BareMetalInstanceCard } from "@/app/dashboard/components/BareMetalInstanceCard";
import type { PoolSubscription } from "@/app/dashboard/components/types";

function makeSub(overrides: Partial<PoolSubscription> = {}): PoolSubscription {
  return {
    id: "bm-1",
    status: "online",
    nature: "baremetal",
    pool_name: "server-pool-7",
    ip: ["10.0.0.5"],
    region: { region_name: "eu-west", city: "Dublin" },
    baremetal: {
      orderId: "ord-1",
      gpuType: "H100",
      gpuCount: 8,
      contractMonths: 12,
      orderStatus: "active",
    },
    ...overrides,
  } as PoolSubscription;
}

describe("BareMetalInstanceCard (PA-288)", () => {
  it("renders the spec line, Bare Metal badge and online status", () => {
    render(<BareMetalInstanceCard subscription={makeSub()} />);
    expect(screen.getByRole("heading", { name: "8x H100" })).toBeInTheDocument();
    expect(screen.getByText("Bare Metal")).toBeInTheDocument();
    expect(screen.getByText(/Online/)).toBeInTheDocument();
  });

  it("renders the region, IP and contract term", () => {
    render(<BareMetalInstanceCard subscription={makeSub()} />);
    expect(screen.getByText(/eu-west/)).toBeInTheDocument();
    expect(screen.getByText(/\(Dublin\)/)).toBeInTheDocument();
    expect(screen.getByText("10.0.0.5")).toBeInTheDocument();
    expect(screen.getByText("12 mo term")).toBeInTheDocument();
    expect(screen.getByText("Prepaid")).toBeInTheDocument();
  });

  it("maps the 'requested' status to its awaiting-assignment label", () => {
    render(
      <BareMetalInstanceCard
        subscription={makeSub({ status: "requested" })}
      />,
    );
    expect(screen.getByText(/Awaiting node assignment/)).toBeInTheDocument();
  });

  it("falls back to the raw status for an unknown value", () => {
    render(
      <BareMetalInstanceCard
        subscription={makeSub({ status: "mystery" })}
      />,
    );
    expect(screen.getByText(/mystery/)).toBeInTheDocument();
  });

  it("renders a single-GPU spec without the count prefix", () => {
    render(
      <BareMetalInstanceCard
        subscription={makeSub({ baremetal: { orderId: "o", gpuType: "L40S", gpuCount: 1 } })}
      />,
    );
    expect(screen.getByRole("heading", { name: "L40S" })).toBeInTheDocument();
  });

  it("shows the Manage link only when onManage is provided and fires it", () => {
    const onManage = vi.fn();
    const { rerender } = render(
      <BareMetalInstanceCard subscription={makeSub()} />,
    );
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();

    rerender(<BareMetalInstanceCard subscription={makeSub()} onManage={onManage} />);
    fireEvent.click(screen.getByRole("button", { name: /manage/i }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("reveals the SSH access panel only when provisioned + online + token", () => {
    render(<BareMetalInstanceCard subscription={makeSub()} token="tok" />);
    // The panel is behind a 'Show SSH access' toggle.
    expect(screen.queryByTestId("ssh-access")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show ssh access/i }));
    expect(screen.getByTestId("ssh-access")).toBeInTheDocument();
  });

  it("hides the SSH access section without a token", () => {
    render(<BareMetalInstanceCard subscription={makeSub()} />);
    expect(
      screen.queryByRole("button", { name: /show ssh access/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the SSH access section when the node is offline", () => {
    render(
      <BareMetalInstanceCard
        subscription={makeSub({ status: "offline" })}
        token="tok"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /show ssh access/i }),
    ).not.toBeInTheDocument();
  });
});
