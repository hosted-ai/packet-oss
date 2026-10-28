// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. GPUCardSSHInfo renders SSH connection details for
// each pod: the ssh command, a masked password that toggles, internal IP, copy
// buttons (clipboard), a Terminal button (only when the pod is Running and has
// ssh_info), and discovered-service links from the subscription pods.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { GPUCardSSHInfo } from "@/app/dashboard/components/PoolSubscriptionCard/GPUCardSSHInfo";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

const runningPod = {
  pod_name: "pod-1",
  pod_status: "Running",
  ssh_info: { cmd: "ssh root@host", pass: "hunter2" },
  internal_ip: "172.16.0.4",
};

describe("GPUCardSSHInfo (PA-288)", () => {
  it("renders the ssh command and a masked password", () => {
    render(
      <GPUCardSSHInfo
        pods={[runningPod]}
        loadingConnection={false}
        onOpenTerminal={vi.fn()}
      />,
    );
    expect(screen.getByText("ssh root@host")).toBeInTheDocument();
    expect(screen.getByText("••••••••••••")).toBeInTheDocument();
    expect(screen.getByText("172.16.0.4")).toBeInTheDocument();
  });

  it("reveals the password when the eye toggle is clicked", () => {
    render(
      <GPUCardSSHInfo
        pods={[runningPod]}
        loadingConnection={false}
        onOpenTerminal={vi.fn()}
      />,
    );
    // The masked password is shown; toggling reveals the real one.
    const buttons = screen.getAllByRole("button");
    // Buttons: [copy cmd, toggle pass, copy pass, copy ip, terminal]
    fireEvent.click(buttons[1]);
    expect(screen.getByText("hunter2")).toBeInTheDocument();
  });

  it("copies the ssh command to the clipboard", () => {
    render(
      <GPUCardSSHInfo
        pods={[runningPod]}
        loadingConnection={false}
        onOpenTerminal={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(writeText).toHaveBeenCalledWith("ssh root@host");
  });

  it("shows a copied confirmation for each copy icon (PA-458)", () => {
    render(
      <GPUCardSSHInfo
        pods={[runningPod]}
        loadingConnection={false}
        onOpenTerminal={vi.fn()}
      />,
    );
    expect(screen.queryByText(/copied/i)).not.toBeInTheDocument();

    // Buttons: [copy cmd, toggle pass, copy pass, copy ip, terminal]
    const buttons = screen.getAllByRole("button");

    fireEvent.click(buttons[0]); // copy ssh cmd
    expect(screen.getByText(/copied/i)).toBeInTheDocument();

    fireEvent.click(buttons[2]); // copy password
    expect(writeText).toHaveBeenCalledWith("hunter2");
    expect(screen.getByText(/copied/i)).toBeInTheDocument();

    fireEvent.click(buttons[3]); // copy internal IP
    expect(writeText).toHaveBeenCalledWith("172.16.0.4");
    expect(screen.getByText(/copied/i)).toBeInTheDocument();
  });

  it("shows a Terminal button for a running pod and fires onOpenTerminal", () => {
    const onOpenTerminal = vi.fn();
    render(
      <GPUCardSSHInfo
        pods={[runningPod]}
        loadingConnection={false}
        onOpenTerminal={onOpenTerminal}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /terminal/i }));
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  it("hides the Terminal button when the pod is not running", () => {
    render(
      <GPUCardSSHInfo
        pods={[{ ...runningPod, pod_status: "ContainerCreating" }]}
        loadingConnection={false}
        onOpenTerminal={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /terminal/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a connecting indicator while loading and no ssh info yet", () => {
    render(
      <GPUCardSSHInfo
        pods={[{ pod_name: "pod-x", pod_status: "Running" }]}
        loadingConnection
        onOpenTerminal={vi.fn()}
      />,
    );
    expect(screen.getByText(/loading connection info/i)).toBeInTheDocument();
  });

  it("renders discovered-service links from the subscription pods", () => {
    render(
      <GPUCardSSHInfo
        pods={[runningPod]}
        subscriptionPods={[
          {
            pod_name: "pod-1",
            pod_status: "Running",
            gpu_count: 1,
            discovered_services: [
              { name: "Jupyter Lab", url: "https://jupyter.test" },
              { name: "Custom Svc", url: "https://svc.test" },
            ],
          },
        ]}
        loadingConnection={false}
        onOpenTerminal={vi.fn()}
      />,
    );
    // Jupyter services are relabelled to "Jupyter".
    const jupyter = screen.getByRole("link", { name: /jupyter/i });
    expect(jupyter).toHaveAttribute("href", "https://jupyter.test");
    const custom = screen.getByRole("link", { name: /custom svc/i });
    expect(custom).toHaveAttribute("href", "https://svc.test");
  });
});
