// @vitest-environment jsdom
//
// PA-288: Unit coverage for the admin ProviderDetailsModal — a prop-driven
// view/edit modal for a single provider. View mode shows stats, company info,
// contact points, infra, and a node list; status-aware footer buttons funnel
// approve/reject/suspend/reactivate through onAction (reject/suspend gated by a
// prompt). Edit mode toggles an inline form, validates required fields, and
// commits through the async onUpdate callback.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  ProviderDetailsModal,
  type ProviderDetails,
} from "@/app/admin/components/providers/ProviderDetailsModal";

function makeProvider(overrides: Partial<ProviderDetails> = {}): ProviderDetails {
  return {
    id: "prov_1",
    companyName: "Acme GPU Co",
    email: "ops@example.com",
    contactName: "Pat Operator",
    phone: "+1-555-0100",
    website: "https://acme.example.com",
    status: "pending",
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    createdAt: "2026-06-14T00:00:00Z",
    estimatedGpuCount: 16,
    gpuTypes: ["H100", "A100"],
    regions: ["US", "EU"],
    additionalInfo: null,
    supportEmail: null,
    supportPhone: null,
    commercialEmail: null,
    commercialPhone: null,
    generalEmail: null,
    nodes: [],
    tokenRevenueSharePercent: null,
    tokenRevenueShareDefault: 70,
    stats: {
      totalNodes: 3,
      activeNodes: 2,
      totalGpus: 24,
      totalPaid: 1234.5,
      totalPending: 0,
    },
    ...overrides,
  };
}

function baseProps() {
  return {
    onClose: vi.fn(),
    onAction: vi.fn(),
    onLoginAs: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("ProviderDetailsModal — view mode", () => {
  it("renders the company name as the title and the status badge", () => {
    render(<ProviderDetailsModal provider={makeProvider()} {...baseProps()} />);
    expect(
      screen.getByRole("heading", { name: "Acme GPU Co" }),
    ).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("renders the stats row", () => {
    render(<ProviderDetailsModal provider={makeProvider()} {...baseProps()} />);
    expect(screen.getByText("Total Nodes")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("$1234.50")).toBeInTheDocument();
  });

  it("renders company info, gpu types and regions", () => {
    render(<ProviderDetailsModal provider={makeProvider()} {...baseProps()} />);
    expect(screen.getByText("Pat Operator")).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByText("H100")).toBeInTheDocument();
    expect(screen.getByText("A100")).toBeInTheDocument();
    expect(screen.getByText("US")).toBeInTheDocument();
    expect(screen.getByText("EU")).toBeInTheDocument();
  });

  it("renders a node list when nodes are present", () => {
    render(
      <ProviderDetailsModal
        provider={makeProvider({
          nodes: [
            {
              id: "node_1",
              providerId: "prov_1",
              hostname: "gpu-host-01",
              ipAddress: "10.0.0.5",
              sshPort: 22,
              sshUsername: "root",
              sshPassword: null,
              status: "active",
              statusMessage: null,
              gpuModel: "H100",
              gpuCount: 8,
              validatedAt: null,
              approvedAt: null,
              createdAt: "2026-06-14T00:00:00Z",
            },
          ],
        })}
        {...baseProps()}
      />,
    );
    expect(screen.getByRole("heading", { name: /nodes \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText("gpu-host-01")).toBeInTheDocument();
    expect(screen.getByText("8x H100")).toBeInTheDocument();
  });

  it("calls onClose when the footer Close button is clicked", () => {
    const props = baseProps();
    render(<ProviderDetailsModal provider={makeProvider()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProviderDetailsModal — status-aware actions", () => {
  it("approves a pending provider", () => {
    const props = baseProps();
    render(<ProviderDetailsModal provider={makeProvider({ status: "pending" })} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(props.onAction).toHaveBeenCalledWith("active");
  });

  it("rejects a pending provider via prompt", () => {
    const props = baseProps();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Incomplete");
    render(<ProviderDetailsModal provider={makeProvider({ status: "pending" })} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(props.onAction).toHaveBeenCalledWith("rejected", "Incomplete");
    promptSpy.mockRestore();
  });

  it("offers Login As and Suspend for an active provider", () => {
    const props = baseProps();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Abuse");
    render(<ProviderDetailsModal provider={makeProvider({ status: "active" })} {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /login as provider/i }));
    expect(props.onLoginAs).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /suspend/i }));
    expect(props.onAction).toHaveBeenCalledWith("suspended", "Abuse");
    promptSpy.mockRestore();
  });

  it("reactivates a suspended provider", () => {
    const props = baseProps();
    render(<ProviderDetailsModal provider={makeProvider({ status: "suspended" })} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /reactivate/i }));
    expect(props.onAction).toHaveBeenCalledWith("active");
  });
});

describe("ProviderDetailsModal — edit mode", () => {
  it("switches to the edit form and back via Cancel", () => {
    render(<ProviderDetailsModal provider={makeProvider()} {...baseProps()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    expect(screen.getByRole("heading", { name: /edit provider/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme GPU Co")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { name: /edit provider/i })).not.toBeInTheDocument();
  });

  it("commits edits through onUpdate and exits edit mode on success", async () => {
    const props = baseProps();
    render(<ProviderDetailsModal provider={makeProvider()} {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);

    fireEvent.change(screen.getByDisplayValue("Acme GPU Co"), {
      target: { value: "Acme GPU Co Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    const [id, updates] = props.onUpdate.mock.calls[0];
    expect(id).toBe("prov_1");
    expect(updates.companyName).toBe("Acme GPU Co Renamed");
    expect(updates.gpuTypes).toEqual(["H100", "A100"]);
    // Empty optional fields are normalized to null.
    expect(updates.supportEmail).toBeNull();
    // Empty token revenue share -> null (use default).
    expect(updates.tokenRevenueSharePercent).toBeNull();

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /edit provider/i })).not.toBeInTheDocument(),
    );
  });

  it("stays in edit mode when onUpdate resolves false", async () => {
    const props = { ...baseProps(), onUpdate: vi.fn().mockResolvedValue(false) };
    render(<ProviderDetailsModal provider={makeProvider()} {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: /edit provider/i })).toBeInTheDocument();
  });

  it("disables Save when a required field is cleared", () => {
    render(<ProviderDetailsModal provider={makeProvider()} {...baseProps()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByDisplayValue("Acme GPU Co"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("parses a token revenue share override into a number", async () => {
    const props = baseProps();
    render(<ProviderDetailsModal provider={makeProvider()} {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/default: 70%/i), {
      target: { value: "55.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled());
    expect(props.onUpdate.mock.calls[0][1].tokenRevenueSharePercent).toBe(55.5);
  });
});
