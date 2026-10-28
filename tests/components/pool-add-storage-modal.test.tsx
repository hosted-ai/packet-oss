// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. AddStorageModal fetches storage options on open
// (GET .../add-storage), lets the user attach an existing volume or create a
// new block (POST .../add-storage with volume_id or storage_block_id), and
// shows a success state then auto-closes. Closed -> renders null. Load/attach
// errors surface inline.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AddStorageModal } from "@/app/dashboard/components/PoolSubscriptionCard/AddStorageModal";

const ENDPOINT = "/api/instances/pool-subscription/sub-1/add-storage";

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseProps = {
  subscriptionId: "sub-1",
  token: "tok",
  onSuccess: vi.fn(),
};

const optionsPayload = {
  attachedVolumes: [],
  availableVolumes: [
    { id: 5, name: "vol-a", size_in_gb: 100, mount_point: "/data", cost: "0.10" },
  ],
  // PA-356: block cost is a number ($/hr at our configured storage rate).
  storageBlocks: [{ id: "blk-1", name: "100GB", size: 100, cost: 0.05 }],
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("AddStorageModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    stubFetch();
    const { container } = render(
      <AddStorageModal {...baseProps} isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fetches options on open with the bearer token", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => optionsPayload });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        ENDPOINT,
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      ),
    );
    expect(await screen.findByText("vol-a")).toBeInTheDocument();
  });

  it("shows the no-options state when neither volumes nor blocks exist", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ attachedVolumes: [], availableVolumes: [], storageBlocks: [] }),
    });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);
    expect(
      await screen.findByText(/no storage capacity available/i),
    ).toBeInTheDocument();
    // The footer button becomes "Close" (not "Cancel").
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("distinguishes an upstream failure from an empty region", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        attachedVolumes: [],
        availableVolumes: [],
        storageBlocks: [],
        loadFailed: true,
      }),
    });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);
    expect(await screen.findByText(/couldn't load storage options/i)).toBeInTheDocument();
  });

  it("offers a volume that is shared with another instance", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        attachedVolumes: [],
        availableVolumes: [
          { id: 721, name: "gpu02-storage-1", size_in_gb: 100, mount_point: "/mnt/shared", status: "IN_USE", cost: 0 },
        ],
        storageBlocks: [],
      }),
    });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);
    expect(await screen.findByText("gpu02-storage-1")).toBeInTheDocument();
    expect(screen.getByText(/shared with another instance/i)).toBeInTheDocument();
  });

  it("POSTs the selected existing volume and shows the success state", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => optionsPayload })
      .mockResolvedValueOnce({ ok: true, text: async () => "{}" });

    const onSuccess = vi.fn();
    render(
      <AddStorageModal {...baseProps} onSuccess={onSuccess} isOpen onClose={vi.fn()} />,
    );

    // Default mode is "existing" with the first volume preselected.
    fireEvent.click(await screen.findByRole("button", { name: /attach storage/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1].body)).toEqual({ volume_id: 5 });
    });
    expect(await screen.findByText(/volume is being attached/i)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("POSTs a storage_block_id when in create mode", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ attachedVolumes: [], availableVolumes: [], storageBlocks: optionsPayload.storageBlocks }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "{}" });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);

    // With no available volumes, the modal defaults to create mode + first block.
    fireEvent.click(await screen.findByRole("button", { name: /attach storage/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(postCall![1].body)).toEqual({ storage_block_id: "blk-1" });
    });
  });

  it("surfaces an attach error inline", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => optionsPayload })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Region full" }),
      });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /attach storage/i }));

    expect(await screen.findByText("Region full")).toBeInTheDocument();
  });

  it("surfaces a load error inline", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "Forbidden" }),
    });

    render(<AddStorageModal {...baseProps} isOpen onClose={vi.fn()} />);
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
  });

  it("fires onClose from the cancel button", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => optionsPayload });

    const onClose = vi.fn();
    render(<AddStorageModal {...baseProps} isOpen onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
