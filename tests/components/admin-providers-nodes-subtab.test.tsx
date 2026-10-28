// @vitest-environment jsdom
//
// PA-288: Unit coverage for the admin providers NodesSubTab — a prop-driven
// node table with a status filter, status-aware action buttons (approve/reject/
// set-live/suspend/reactivate/edit-pricing/GPUaaS), an SSH credential reveal +
// copy panel, and a pricing modal that funnels approve/update-pricing through
// the onAction callback. The component itself makes no fetch calls; the GPUaaS
// provisioning modal is stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { NodesSubTab } from "@/app/admin/components/providers/NodesSubTab";
import type { ProviderNode, GpuType, PricingTier } from "@/app/admin/types";

vi.mock("@/app/admin/components/GpuaasProvisioningModal", () => ({
  GpuaasProvisioningModal: ({ nodeId }: { nodeId: string }) => (
    <div data-testid="gpuaas-modal">gpuaas:{nodeId}</div>
  ),
}));

function makeNode(overrides: Partial<ProviderNode> = {}): ProviderNode {
  return {
    id: "node_1",
    providerId: "prov_1",
    hostname: "gpu-host-01",
    ipAddress: "10.0.0.5",
    sshPort: 22,
    sshUsername: "root",
    sshPassword: null,
    status: "pending_approval",
    statusMessage: null,
    gpuModel: "H100",
    gpuCount: 8,
    validatedAt: null,
    approvedAt: null,
    createdAt: "2026-06-14T00:00:00Z",
    provider: { id: "prov_1", companyName: "Acme GPU Co", email: "ops@example.com" },
    pricingTier: null,
    customProviderRateCents: null,
    revenueSharePercent: null,
    requestedGpuType: null,
    ...overrides,
  };
}

const gpuTypes: GpuType[] = [];
const pricingTiers: PricingTier[] = [
  {
    id: "tier_1",
    name: "Standard H100",
    gpuModel: "H100",
    providerRateCents: 80,
    customerRateCents: 150,
    isRevenueShare: false,
    revenueSharePercent: null,
  },
];

function baseProps() {
  return {
    nodes: [] as ProviderNode[],
    filter: "all",
    actionLoading: null as string | null,
    gpuTypes,
    pricingTiers,
    onFilterChange: vi.fn(),
    onAction: vi.fn(),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("NodesSubTab — table & filter", () => {
  it("renders the empty state when there are no nodes", () => {
    render(<NodesSubTab {...baseProps()} />);
    expect(screen.getByText(/no nodes found/i)).toBeInTheDocument();
  });

  it("renders a node row with hostname, ip, provider, gpu and status", () => {
    render(<NodesSubTab {...baseProps()} nodes={[makeNode()]} />);
    expect(screen.getByText("gpu-host-01")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.5")).toBeInTheDocument();
    expect(screen.getByText("Acme GPU Co")).toBeInTheDocument();
    expect(screen.getByText("8x H100")).toBeInTheDocument();
    expect(screen.getByText(/pending approval/)).toBeInTheDocument();
  });

  it("fires onFilterChange when the status filter changes", () => {
    const props = baseProps();
    render(<NodesSubTab {...props} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });
    expect(props.onFilterChange).toHaveBeenCalledWith("active");
  });
});

describe("NodesSubTab — status-aware actions", () => {
  it("rejects a pending node via prompt + onAction", () => {
    const props = baseProps();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Bad GPUs");
    render(<NodesSubTab {...props} nodes={[makeNode()]} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(props.onAction).toHaveBeenCalledWith("node_1", "reject", "Bad GPUs");
    promptSpy.mockRestore();
  });

  it("does not call onAction when the rejection prompt is cancelled", () => {
    const props = baseProps();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<NodesSubTab {...props} nodes={[makeNode()]} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(props.onAction).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("sets an approved node live", () => {
    const props = baseProps();
    render(<NodesSubTab {...props} nodes={[makeNode({ status: "approved" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /set live/i }));
    expect(props.onAction).toHaveBeenCalledWith("node_1", "set-live");
  });

  it("suspends an active node via prompt", () => {
    const props = baseProps();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Maintenance");
    render(<NodesSubTab {...props} nodes={[makeNode({ status: "active" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /suspend/i }));
    expect(props.onAction).toHaveBeenCalledWith("node_1", "suspend", "Maintenance");
    promptSpy.mockRestore();
  });

  it("reactivates a suspended node", () => {
    const props = baseProps();
    render(<NodesSubTab {...props} nodes={[makeNode({ status: "suspended" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /reactivate/i }));
    expect(props.onAction).toHaveBeenCalledWith("node_1", "set-live");
  });

  it("opens the (mocked) GPUaaS modal for an approved node", () => {
    render(<NodesSubTab {...baseProps()} nodes={[makeNode({ status: "approved" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /gpuaas/i }));
    expect(screen.getByTestId("gpuaas-modal")).toHaveTextContent("gpuaas:node_1");
  });
});

describe("NodesSubTab — SSH credentials", () => {
  it("reveals and copies SSH credentials", () => {
    render(
      <NodesSubTab
        {...baseProps()}
        nodes={[makeNode({ status: "active", sshPassword: "s3cr3t", sshUsername: "ubuntu" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show ssh/i }));
    expect(screen.getByText("s3cr3t")).toBeInTheDocument();
    expect(screen.getByText("ubuntu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy ssh command/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "ssh ubuntu@10.0.0.5 -p 22",
    );

    fireEvent.click(screen.getByRole("button", { name: /copy password/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("s3cr3t");
  });

  it("does not show the SSH toggle when no password is stored", () => {
    render(<NodesSubTab {...baseProps()} nodes={[makeNode({ status: "active" })]} />);
    expect(screen.queryByRole("button", { name: /show ssh/i })).not.toBeInTheDocument();
  });
});

describe("NodesSubTab — pricing modal", () => {
  it("approves a pending node with a selected pricing tier", () => {
    const props = baseProps();
    render(<NodesSubTab {...props} nodes={[makeNode()]} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    const dialog = screen.getByText(/approve server & set pricing/i).closest("div")!.parentElement!;
    // Select a pricing tier (none auto-matched without gpuModel match here).
    fireEvent.change(within(dialog).getByRole("combobox"), {
      target: { value: "tier_1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve with pricing/i }));

    expect(props.onAction).toHaveBeenCalledWith(
      "node_1",
      "approve",
      undefined,
      expect.objectContaining({ pricingTierId: "tier_1" }),
    );
  });

  it("auto-matches a tier on the node's gpuModel and enables approval", () => {
    const props = baseProps();
    render(<NodesSubTab {...props} nodes={[makeNode({ gpuModel: "H100" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    // tier_1 has gpuModel "H100" -> auto-selected, submit enabled immediately.
    const submit = screen.getByRole("button", { name: /approve with pricing/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(props.onAction).toHaveBeenCalledWith(
      "node_1",
      "approve",
      undefined,
      expect.objectContaining({ pricingTierId: "tier_1" }),
    );
  });

  it("updates pricing for an approved node via Edit Pricing", () => {
    const props = baseProps();
    render(
      <NodesSubTab
        {...props}
        nodes={[
          makeNode({
            status: "approved",
            pricingTier: {
              id: "tier_1",
              name: "Standard H100",
              providerRateCents: 80,
              customerRateCents: 150,
              isRevenueShare: false,
              revenueSharePercent: null,
            },
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit pricing/i }));
    expect(screen.getByText(/edit node pricing/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /update pricing/i }));
    expect(props.onAction).toHaveBeenCalledWith(
      "node_1",
      "update-pricing",
      undefined,
      expect.objectContaining({ pricingTierId: "tier_1" }),
    );
  });

  it("keeps the approval submit disabled until a tier or custom rate is chosen", () => {
    // gpuModel that matches no tier so nothing is auto-selected.
    render(
      <NodesSubTab
        {...baseProps()}
        nodes={[makeNode({ gpuModel: "MI300X", requestedGpuType: null })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(
      screen.getByRole("button", { name: /approve with pricing/i }),
    ).toBeDisabled();
  });

  it("closes the pricing modal on Cancel", () => {
    render(<NodesSubTab {...baseProps()} nodes={[makeNode()]} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/approve server & set pricing/i)).not.toBeInTheDocument();
  });
});
