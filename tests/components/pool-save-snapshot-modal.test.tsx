// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. SaveSnapshotModal is a 3-step wizard: name ->
// options -> saving. "Next" calls GET .../snapshot/prepare; the options step
// branches on whether the pod already has persistent storage. "Save Snapshot"
// POSTs .../snapshot with the assembled body (displayName, optional saveData +
// storageBlockId, optional terminateAfterSave) and then closes + fires
// callbacks. Errors surface inline and return to the options step.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SaveSnapshotModal } from "@/app/dashboard/components/PoolSubscriptionCard/SaveSnapshotModal";

const PREPARE = "/api/instances/pool-subscription/sub-1/snapshot/prepare";
const SNAPSHOT = "/api/instances/pool-subscription/sub-1/snapshot";

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseProps = {
  token: "tok",
  subscriptionId: "sub-1",
  displayName: "My GPU",
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("SaveSnapshotModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    stubFetch();
    const { container } = render(
      <SaveSnapshotModal {...baseProps} isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the name step first", () => {
    stubFetch();
    render(<SaveSnapshotModal {...baseProps} isOpen onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /save pod configuration/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
  });

  it("calls prepare on Next and advances to the options step", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        existingVolumeCount: 1,
        dataSizeGb: null,
        storageOptions: [],
        requiresDataCopy: false,
        existingVolumes: [{ id: "v1", name: "data-vol", sizeGb: 100 }],
      }),
    });

    render(<SaveSnapshotModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        PREPARE,
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      ),
    );
    // Pod has existing storage -> the "Great news!" branch.
    expect(await screen.findByText(/great news/i)).toBeInTheDocument();
    expect(screen.getByText(/data-vol/)).toBeInTheDocument();
  });

  it("surfaces a prepare error on the name step", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Pod not ready" }),
    });

    render(<SaveSnapshotModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText("Pod not ready")).toBeInTheDocument();
  });

  it("POSTs the snapshot with displayName and fires callbacks (existing storage)", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          existingVolumeCount: 1,
          dataSizeGb: null,
          storageOptions: [],
          requiresDataCopy: false,
          existingVolumes: [],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "snap-1" }) });

    const onClose = vi.fn();
    const onSnapshotCreated = vi.fn();
    render(
      <SaveSnapshotModal
        {...baseProps}
        isOpen
        onClose={onClose}
        onSnapshotCreated={onSnapshotCreated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save snapshot/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[0] === SNAPSHOT);
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1].body)).toEqual({ displayName: "My GPU" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSnapshotCreated).toHaveBeenCalledTimes(1);
  });

  it("includes terminateAfterSave and fires onRefresh when that box is checked", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          existingVolumeCount: 1,
          dataSizeGb: null,
          storageOptions: [],
          requiresDataCopy: false,
          existingVolumes: [],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "snap-2" }) });

    const onRefresh = vi.fn();
    render(
      <SaveSnapshotModal {...baseProps} isOpen onClose={vi.fn()} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    const termCheckbox = await screen.findByRole("checkbox", {
      name: /terminate after saving/i,
    });
    fireEvent.click(termCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /save snapshot/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[0] === SNAPSHOT);
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        displayName: "My GPU",
        terminateAfterSave: true,
      });
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("returns to the options step and shows the error when save fails", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          existingVolumeCount: 1,
          dataSizeGb: null,
          storageOptions: [],
          requiresDataCopy: false,
          existingVolumes: [],
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Snapshot failed" }) });

    render(<SaveSnapshotModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save snapshot/i }));

    expect(await screen.findByText("Snapshot failed")).toBeInTheDocument();
    // Still on the options step (Save button visible again).
    expect(
      screen.getByRole("button", { name: /save snapshot/i }),
    ).toBeInTheDocument();
  });

  it("fires onClose from the name-step cancel button", () => {
    stubFetch();
    const onClose = vi.fn();
    render(<SaveSnapshotModal {...baseProps} isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
