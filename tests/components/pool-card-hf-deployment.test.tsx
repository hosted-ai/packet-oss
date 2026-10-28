// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. GPUCardHfDeployment renders a HuggingFace model
// deployment panel: name + status badge, an error line, and — when the model
// is running — action buttons that branch on whether port 8000 is exposed
// (Test Chat vs Expose API), plus Netdata / Open WebUI links when configured.
// Logs expand/collapse. The heavy InferencePlayground and GPUMetricsCard
// children are stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/InferencePlayground", () => ({
  default: ({ modelName }: { modelName: string }) => (
    <div data-testid="playground">{modelName}</div>
  ),
}));
vi.mock("@/components/GPUMetricsCard", () => ({
  default: () => <div data-testid="gpu-metrics" />,
}));

import { GPUCardHfDeployment } from "@/app/dashboard/components/PoolSubscriptionCard/GPUCardHfDeployment";
import type { HfDeploymentInfo } from "@/app/dashboard/components/types";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

const deployment: HfDeploymentInfo = {
  id: "dep-1",
  hfItemId: "meta-llama/Llama-3.1-8B",
  hfItemName: "Llama 3.1 8B",
  status: "running",
  errorMessage: null,
  createdAt: "2026-06-01T00:00:00Z",
};

const baseProps = {
  hfDeployment: deployment,
  subscriptionId: "sub-1",
  token: "tok",
  exposedServices: [],
  onExposeVllmApi: vi.fn().mockResolvedValue(undefined),
  exposingVllmApi: false,
};

describe("GPUCardHfDeployment (PA-288)", () => {
  it("renders the model name and status badge", () => {
    render(
      <GPUCardHfDeployment
        {...baseProps}
        hfStatus={{ status: "running", message: "Serving" }}
      />,
    );
    expect(screen.getByText("Llama 3.1 8B")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("Serving")).toBeInTheDocument();
  });

  it("renders the deployment error message when present", () => {
    render(
      <GPUCardHfDeployment
        {...baseProps}
        hfDeployment={{ ...deployment, errorMessage: "OOM killed" }}
        hfStatus={{ status: "failed", message: "Failed" }}
      />,
    );
    expect(screen.getByText("OOM killed")).toBeInTheDocument();
  });

  it("shows 'Expose API Endpoint' when running but port 8000 is not exposed", () => {
    render(
      <GPUCardHfDeployment
        {...baseProps}
        exposedServices={[]}
        hfStatus={{ status: "running", message: "ok" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /expose api endpoint/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /test chat/i }),
    ).not.toBeInTheDocument();
  });

  it("fires onExposeVllmApi when the expose button is clicked", () => {
    const onExposeVllmApi = vi.fn().mockResolvedValue(undefined);
    render(
      <GPUCardHfDeployment
        {...baseProps}
        onExposeVllmApi={onExposeVllmApi}
        hfStatus={{ status: "running", message: "ok" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expose api endpoint/i }));
    expect(onExposeVllmApi).toHaveBeenCalledTimes(1);
  });

  it("shows 'Test Chat' and GPU metrics once port 8000 is exposed, and opens the playground", () => {
    render(
      <GPUCardHfDeployment
        {...baseProps}
        exposedServices={[{ id: 1, internal_port: 8000 }]}
        hfStatus={{ status: "running", message: "ok" }}
      />,
    );
    expect(screen.getByTestId("gpu-metrics")).toBeInTheDocument();
    const testChat = screen.getByRole("button", { name: /test chat/i });
    fireEvent.click(testChat);
    expect(screen.getByTestId("playground")).toHaveTextContent("Llama 3.1 8B");
  });

  it("renders Netdata and Open WebUI links when configured", () => {
    render(
      <GPUCardHfDeployment
        {...baseProps}
        hfDeployment={{
          ...deployment,
          netdata: true,
          netdataPort: 19999,
          openWebUI: true,
          webUiPort: 3000,
        }}
        sshHost="gpu.host"
        exposedServices={[{ id: 1, internal_port: 8000 }]}
        hfStatus={{ status: "running", message: "ok" }}
      />,
    );
    expect(screen.getByRole("link", { name: /gpu metrics/i })).toHaveAttribute(
      "href",
      "http://gpu.host:19999",
    );
    expect(screen.getByRole("link", { name: /chat ui/i })).toHaveAttribute(
      "href",
      "http://gpu.host:3000",
    );
  });

  it("expands logs and copies them in the full-logs modal", () => {
    render(
      <GPUCardHfDeployment
        {...baseProps}
        exposedServices={[{ id: 1, internal_port: 8000 }]}
        hfStatus={{ status: "running", message: "ok", logs: "line-1\nline-2" }}
      />,
    );
    // Inline expand.
    fireEvent.click(screen.getByRole("button", { name: /show logs/i }));
    expect(screen.getAllByText(/line-1/).length).toBeGreaterThan(0);

    // Open the full-logs modal and copy.
    fireEvent.click(screen.getByRole("button", { name: /view full logs/i }));
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith("line-1\nline-2");
  });

  it("falls back to the deployment status when no live hfStatus is given", () => {
    render(<GPUCardHfDeployment {...baseProps} hfStatus={null} />);
    // Status badge uses hfDeployment.status; "Deployment started ..." message.
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/deployment started/i)).toBeInTheDocument();
  });
});
