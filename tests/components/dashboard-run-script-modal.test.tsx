// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): RunScriptModal — the "Run Script" pod modal.
// Renders only when open, POSTs the script to /api/instances/run-script with
// the pod's subscriptionId/podName, and surfaces the result (exit code +
// output) or an error. Cancel and the X close it; reopening clears state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { RunScriptModal } from "@/app/dashboard/components/RunScriptModal";

function mockFetchOnce(body: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  subscriptionId: "sub-123",
  token: "test-token",
  podName: "pod-abc",
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("RunScriptModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<RunScriptModal {...baseProps} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the script editor and actions when open", () => {
    mockFetchOnce({});
    render(<RunScriptModal {...baseProps} />);
    expect(screen.getByRole("heading", { name: /run script/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Hello from GPU/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run script$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("disables Run Script while the script box is empty", () => {
    mockFetchOnce({});
    render(<RunScriptModal {...baseProps} />);
    expect(screen.getByRole("button", { name: /^run script$/i })).toBeDisabled();
  });

  it("enables Run Script once a script is entered", () => {
    mockFetchOnce({});
    render(<RunScriptModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Hello from GPU/i), {
      target: { value: "echo hi" },
    });
    expect(screen.getByRole("button", { name: /^run script$/i })).toBeEnabled();
  });

  it("POSTs the script with subscriptionId, podName and a 120s timeout", async () => {
    const fetchMock = mockFetchOnce({ success: true, output: "ok", exitCode: 0 });
    render(<RunScriptModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Hello from GPU/i), {
      target: { value: "  nvidia-smi  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^run script$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/run-script");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    const sent = JSON.parse(opts.body);
    expect(sent).toEqual({
      script: "nvidia-smi", // trimmed
      subscriptionId: "sub-123",
      podName: "pod-abc",
      timeout: 120,
    });
  });

  it("renders the exit code and output on success", async () => {
    mockFetchOnce({ success: true, output: "driver loaded", exitCode: 0 });
    render(<RunScriptModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Hello from GPU/i), {
      target: { value: "echo hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^run script$/i }));

    await waitFor(() => expect(screen.getByText(/Exit code: 0/i)).toBeInTheDocument());
    expect(screen.getByText("driver loaded")).toBeInTheDocument();
  });

  it("shows '(no output)' when the command produced no output", async () => {
    mockFetchOnce({ success: true, output: "", exitCode: 0 });
    render(<RunScriptModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Hello from GPU/i), {
      target: { value: "true" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^run script$/i }));

    await waitFor(() => expect(screen.getByText("(no output)")).toBeInTheDocument());
  });

  it("surfaces a server error message when the response is not ok", async () => {
    mockFetchOnce({ error: "pod offline" }, false);
    render(<RunScriptModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Hello from GPU/i), {
      target: { value: "echo hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^run script$/i }));

    await waitFor(() => expect(screen.getByText("pod offline")).toBeInTheDocument());
  });

  it("invokes onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    mockFetchOnce({});
    render(<RunScriptModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
