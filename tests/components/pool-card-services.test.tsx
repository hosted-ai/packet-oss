// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. GPUCardServices lists exposed services and (when
// canProvision) lets the user open an expose form (POST /api/services), edit
// (PUT), or delete (DELETE, behind a window.confirm). The expose controls are
// hidden for read-only roles (canProvision=false). Validation uses
// window.alert. External URLs and known-service credentials (jupyter/vscode)
// render with copy buttons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  GPUCardServices,
  type ExposedService,
} from "@/app/dashboard/components/PoolSubscriptionCard/GPUCardServices";

const writeText = vi.fn();

function stubFetch() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => ({ services: [] }) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

const baseProps = {
  token: "tok",
  subscriptionId: "sub-1",
  podName: "pod-1",
  onServicesUpdated: vi.fn(),
  loadingServices: false,
};

const httpService: ExposedService = {
  id: 42,
  service_name: "jupyter-lab",
  port: 8888,
  external_port: 30888,
  protocol: "TCP",
  service_type: "http",
  status: "EXPOSED",
  ip: "1.2.3.4",
};

describe("GPUCardServices (PA-288)", () => {
  it("shows the empty hint when no services are exposed", () => {
    stubFetch();
    render(<GPUCardServices {...baseProps} exposedServices={[]} canProvision />);
    expect(screen.getByText(/no services exposed yet/i)).toBeInTheDocument();
  });

  it("renders an exposed service with its external URL and jupyter credentials", () => {
    stubFetch();
    render(
      <GPUCardServices {...baseProps} exposedServices={[httpService]} canProvision />,
    );
    expect(screen.getByText("jupyter-lab")).toBeInTheDocument();
    expect(screen.getByText("http://1.2.3.4:30888")).toBeInTheDocument();
    // jupyter services surface a Token credential of "packet".
    expect(screen.getByText("Token:")).toBeInTheDocument();
    expect(screen.getByText("packet")).toBeInTheDocument();
  });

  it("hides expose/delete controls for read-only (canProvision=false) users", () => {
    stubFetch();
    render(
      <GPUCardServices
        {...baseProps}
        exposedServices={[httpService]}
        canProvision={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /expose port/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the expose form and POSTs a new service", async () => {
    const fetchMock = stubFetch();
    render(<GPUCardServices {...baseProps} exposedServices={[]} canProvision />);

    fireEvent.click(screen.getByRole("button", { name: /expose port/i }));
    fireEvent.change(screen.getByPlaceholderText(/vllm-api/i), {
      target: { value: "my-svc" },
    });
    fireEvent.change(screen.getByPlaceholderText(/8000/i), {
      target: { value: "8080" },
    });
    fireEvent.click(screen.getByRole("button", { name: /expose service/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/services",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/services" && c[1]?.method === "POST",
    )!;
    expect(JSON.parse(postCall[1].body)).toMatchObject({
      pod_name: "pod-1",
      pool_subscription_id: "sub-1",
      port: 8080,
      service_name: "my-svc",
    });
  });

  it("sends 'none' for the raw-TCP option, not the unsupported 'NodePort' (PA-627)", async () => {
    const fetchMock = stubFetch();
    render(<GPUCardServices {...baseProps} exposedServices={[]} canProvision />);

    fireEvent.click(screen.getByRole("button", { name: /expose port/i }));
    fireEvent.change(screen.getByPlaceholderText(/vllm-api/i), {
      target: { value: "raw-svc" },
    });
    fireEvent.change(screen.getByPlaceholderText(/8000/i), {
      target: { value: "9000" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: /expose service/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/services",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/services" && c[1]?.method === "POST",
    )!;
    expect(JSON.parse(postCall[1].body)).toMatchObject({ service_type: "none" });
  });

  it("alerts when the expose form is submitted without name/port", () => {
    stubFetch();
    render(<GPUCardServices {...baseProps} exposedServices={[]} canProvision />);
    fireEvent.click(screen.getByRole("button", { name: /expose port/i }));
    fireEvent.click(screen.getByRole("button", { name: /expose service/i }));
    expect(window.alert).toHaveBeenCalledWith(
      "Please provide a service name and port",
    );
  });

  it("deletes a service after the user confirms", async () => {
    const fetchMock = stubFetch();
    render(
      <GPUCardServices {...baseProps} exposedServices={[httpService]} canProvision />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/services?id=42",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("does not delete when the confirm dialog is dismissed", () => {
    const fetchMock = stubFetch();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <GPUCardServices {...baseProps} exposedServices={[httpService]} canProvision />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies the external URL to the clipboard", () => {
    stubFetch();
    render(
      <GPUCardServices {...baseProps} exposedServices={[httpService]} canProvision />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy url/i }));
    expect(writeText).toHaveBeenCalledWith("http://1.2.3.4:30888");
  });
});
