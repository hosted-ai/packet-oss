// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): DocsTab — documentation viewer. A <select>
// switches the rendered doc panel. The doc panels (./docs barrel) and the
// dynamic swagger-ui-react import are heavy/premium-adjacent, so we stub them
// to lightweight markers and assert the switch behaviour, not their content.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub every doc panel with a labelled marker so we can assert which renders.
vi.mock("@/app/dashboard/components/docs", () => ({
  GettingStartedDoc: () => <div data-testid="doc">getting-started</div>,
  HuggingFaceDoc: () => <div data-testid="doc">huggingface</div>,
  Pro6000BlackwellDoc: () => <div data-testid="doc">pro-6000</div>,
  InferencePlaygroundDoc: () => <div data-testid="doc">playground</div>,
  GPUMetricsDoc: () => <div data-testid="doc">gpu-metrics</div>,
  TokenUsageDoc: () => <div data-testid="doc">token-usage</div>,
  ServiceExposureDoc: () => <div data-testid="doc">service-exposure</div>,
  PersistentStorageDoc: () => <div data-testid="doc">storage</div>,
  SSHAccessDoc: () => <div data-testid="doc">ssh</div>,
  BillingDoc: () => <div data-testid="doc">billing</div>,
  BudgetControlsDoc: () => <div data-testid="doc">budget</div>,
  BrowserIDEDoc: () => <div data-testid="doc">browser-ide</div>,
}));

// next/dynamic's swagger import — replace with a marker so jsdom doesn't try
// to load the real swagger-ui-react module + its CSS.
vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="swagger">swagger-ui</div>,
}));
vi.mock("swagger-ui-react/swagger-ui.css", () => ({}));

import { DocsTab } from "@/app/dashboard/components/DocsTab";

describe("DocsTab", () => {
  it("renders the Documentation header and defaults to Getting Started", () => {
    render(<DocsTab isOwner={true} />);
    expect(screen.getByRole("heading", { name: /documentation/i })).toBeInTheDocument();
    expect(screen.getByTestId("doc")).toHaveTextContent("getting-started");
  });

  it("renders the topic select with all sections", () => {
    render(<DocsTab isOwner={true} />);
    const select = screen.getByLabelText(/topic/i);
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe("getting-started");
  });

  it("switches the rendered doc when a new section is chosen", () => {
    render(<DocsTab isOwner={true} />);
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "ssh-access" } });
    expect(screen.getByTestId("doc")).toHaveTextContent("ssh");
  });

  it("renders the storage doc panel for the persistent-storage section", () => {
    render(<DocsTab isOwner={true} />);
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "persistent-storage" } });
    expect(screen.getByTestId("doc")).toHaveTextContent("storage");
  });

  it("renders the swagger panel for the API Reference section", () => {
    render(<DocsTab isOwner={true} />);
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "api" } });
    expect(screen.getByTestId("swagger")).toBeInTheDocument();
  });

  it("shows the NEW badge for a section flagged isNew", () => {
    render(<DocsTab isOwner={true} />);
    fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: "gpu-metrics" } });
    expect(screen.getByText("NEW")).toBeInTheDocument();
  });

  it("does not show the NEW badge for getting-started", () => {
    render(<DocsTab isOwner={true} />);
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });
});
