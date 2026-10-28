// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): StorageTab — lists persistent storage volumes
// from /api/instances/shared-volumes, summarises totals, and (when canManage)
// runs a dryRun delete to surface affected snapshots before confirming.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { StorageTab } from "@/app/dashboard/components/StorageTab";

const VOL_AVAILABLE = {
  id: 1,
  name: "data-vol",
  size_in_gb: 100,
  region_id: 1,
  status: "available",
  mount_point: "/mnt/data",
  cost: 0.05,
  displaySize: "100 GB",
  isAvailable: true,
};
const VOL_ATTACHED = {
  id: 2,
  name: "attached-vol",
  size_in_gb: 50,
  region_id: 1,
  status: "attached",
  mount_point: "/mnt/run",
  cost: 0.02,
  displaySize: "50 GB",
  isAvailable: false,
};

function stubFetch(opts: {
  volumes?: unknown[];
  getOk?: boolean;
  dryRun?: unknown;
  deleteOk?: boolean;
  deleteBody?: unknown;
}) {
  const fetchMock = vi.fn((_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "DELETE") {
      const parsed = init.body ? JSON.parse(init.body) : {};
      if (parsed.dryRun) {
        return Promise.resolve({ ok: true, json: async () => opts.dryRun ?? { affectedSnapshots: [] } });
      }
      return Promise.resolve({ ok: opts.deleteOk ?? true, json: async () => opts.deleteBody ?? {} });
    }
    return Promise.resolve({ ok: opts.getOk ?? true, json: async () => ({ volumes: opts.volumes ?? [] }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("StorageTab", () => {
  it("renders the empty state when there are no volumes", async () => {
    stubFetch({ volumes: [] });
    render(<StorageTab token="test-token" />);
    await waitFor(() => expect(screen.getByText(/no storage volumes/i)).toBeInTheDocument());
  });

  it("lists volumes with their size and status", async () => {
    stubFetch({ volumes: [VOL_AVAILABLE, VOL_ATTACHED] });
    render(<StorageTab token="test-token" />);
    await waitFor(() => screen.getByText("data-vol"));
    expect(screen.getByText("attached-vol")).toBeInTheDocument();
    expect(screen.getByText("available")).toBeInTheDocument();
    expect(screen.getByText("attached")).toBeInTheDocument();
  });

  it("shows the summary cards with the volume count when volumes exist", async () => {
    stubFetch({ volumes: [VOL_AVAILABLE, VOL_ATTACHED] });
    render(<StorageTab token="test-token" />);
    await waitFor(() => screen.getByText("Total Volumes"));
    expect(screen.getByText("Total Storage")).toBeInTheDocument();
    // 100 + 50 = 150 GB total
    expect(screen.getByText("150 GB")).toBeInTheDocument();
  });

  it("offers a Delete action for an available volume when canManage", async () => {
    stubFetch({ volumes: [VOL_AVAILABLE] });
    render(<StorageTab token="test-token" canManage={true} />);
    await waitFor(() => screen.getByText("data-vol"));
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });

  it("hides Delete actions when canManage is false", async () => {
    stubFetch({ volumes: [VOL_AVAILABLE] });
    render(<StorageTab token="test-token" canManage={false} />);
    await waitFor(() => screen.getByText("data-vol"));
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("shows the detach hint instead of Delete for an attached volume", async () => {
    stubFetch({ volumes: [VOL_ATTACHED] });
    render(<StorageTab token="test-token" />);
    await waitFor(() => screen.getByText("attached-vol"));
    expect(screen.getByText(/detach from gpu to delete/i)).toBeInTheDocument();
  });

  it("opens the confirm modal and surfaces affected snapshots from the dryRun", async () => {
    stubFetch({
      volumes: [VOL_AVAILABLE],
      dryRun: { affectedSnapshots: [{ id: "s1", name: "snap-one" }] },
    });
    render(<StorageTab token="test-token" />);
    await waitFor(() => screen.getByText("data-vol"));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByText(/delete storage volume/i)).toBeInTheDocument());
    expect(screen.getByText("snap-one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete volume & snapshots/i })).toBeInTheDocument();
  });

  it("issues the real DELETE and re-fetches the list on confirm", async () => {
    const fetchMock = stubFetch({
      volumes: [VOL_AVAILABLE],
      dryRun: { affectedSnapshots: [] },
      deleteOk: true,
      deleteBody: { success: true },
    });
    render(<StorageTab token="test-token" />);
    await waitFor(() => screen.getByText("data-vol"));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => screen.getByRole("button", { name: /^delete volume$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete volume$/i }));

    await waitFor(() => {
      const realDeletes = fetchMock.mock.calls.filter(
        (c) => c[1]?.method === "DELETE" && !JSON.parse(c[1].body).dryRun
      );
      expect(realDeletes.length).toBe(1);
    });
  });

  it("renders an error banner when the list fetch fails", async () => {
    stubFetch({ getOk: false });
    render(<StorageTab token="test-token" />);
    await waitFor(() => expect(screen.getByText(/failed to fetch storage volumes/i)).toBeInTheDocument());
  });

  it("shows the delete error when the real delete returns not-ok", async () => {
    stubFetch({
      volumes: [VOL_AVAILABLE],
      dryRun: { affectedSnapshots: [] },
      deleteOk: false,
      deleteBody: { error: "volume busy" },
    });
    render(<StorageTab token="test-token" />);
    await waitFor(() => screen.getByText("data-vol"));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => screen.getByRole("button", { name: /^delete volume$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete volume$/i }));

    await waitFor(() => expect(screen.getByText("volume busy")).toBeInTheDocument());
  });
});
