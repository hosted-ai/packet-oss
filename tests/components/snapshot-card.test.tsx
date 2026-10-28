// @vitest-environment jsdom
//
// PA-287: unit coverage for SnapshotCard
// (src/app/dashboard/components/SnapshotCard.tsx). Displays a pod snapshot
// (name, type pill, GPU count, storage, HF model) and exposes Resume / Delete
// flows behind modals that hit /api/instances/* and call onRestore/onDelete.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SnapshotCard } from "@/app/dashboard/components/SnapshotCard";
import type { PodSnapshot } from "@/app/dashboard/components/types";

function makeSnapshot(overrides: Partial<PodSnapshot> = {}): PodSnapshot {
  return {
    id: "snap-1",
    displayName: "My Snapshot",
    notes: null,
    snapshotType: "full",
    poolId: "pool-1",
    poolName: "RTX-Pool",
    vgpus: 2,
    hasStorage: true,
    storage: { id: 1, name: "vol-1", sizeGb: 100 },
    hfModel: { id: "meta/llama", name: "Llama", type: "model", deployScript: null },
    createdAt: "2026-01-15T10:30:00Z",
    updatedAt: "2026-01-15T10:30:00Z",
    ...overrides,
  };
}

function stubFetch(fn: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fn);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

const noop = () => {};

describe("SnapshotCard — display", () => {
  it("renders the snapshot name", () => {
    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("My Snapshot")).toBeInTheDocument();
  });

  it("shows 'Full' for a full snapshot and 'Template' for a template", () => {
    const { rerender } = render(
      <SnapshotCard
        snapshot={makeSnapshot({ snapshotType: "full" })}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("Full")).toBeInTheDocument();

    rerender(
      <SnapshotCard
        snapshot={makeSnapshot({ snapshotType: "template" })}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("Template")).toBeInTheDocument();
  });

  it("renders pool name, GPU count, and storage size", () => {
    render(
      <SnapshotCard
        snapshot={makeSnapshot({ vgpus: 2 })}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("RTX-Pool")).toBeInTheDocument();
    expect(screen.getByText("2 GPUs")).toBeInTheDocument();
    expect(screen.getByText("100GB")).toBeInTheDocument();
  });

  it("uses singular 'GPU' for a single-GPU snapshot", () => {
    render(
      <SnapshotCard
        snapshot={makeSnapshot({ vgpus: 1 })}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("1 GPU")).toBeInTheDocument();
  });

  it("renders the HF model name when present", () => {
    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("Llama")).toBeInTheDocument();
  });
});

describe("SnapshotCard — resume flow", () => {
  it("opens the resume modal when Resume is clicked", () => {
    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(screen.getByText("Resume Pod")).toBeInTheDocument();
    expect(screen.getByText(/Launch a new pod from/i)).toBeInTheDocument();
  });

  it("restores via the API and calls onRestore on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-instance" }),
    });
    stubFetch(fetchMock);
    const onRestore = vi.fn();

    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="tok-123"
        onRestore={onRestore}
        onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    fireEvent.click(screen.getByRole("button", { name: /launch pod/i }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/instances/from-snapshot/snap-1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a restore error and does not call onRestore", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Out of capacity" }),
    });
    stubFetch(fetchMock);
    const onRestore = vi.fn();

    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="t"
        onRestore={onRestore}
        onDelete={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    fireEvent.click(screen.getByRole("button", { name: /launch pod/i }));

    await waitFor(() =>
      expect(screen.getByText("Out of capacity")).toBeInTheDocument(),
    );
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe("SnapshotCard — delete flow", () => {
  it("opens the delete confirmation", () => {
    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="t"
        onRestore={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete snapshot/i }));
    expect(screen.getByText("Delete Snapshot?")).toBeInTheDocument();
  });

  it("deletes via the API and calls onDelete on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    stubFetch(fetchMock);
    const onDelete = vi.fn();

    render(
      <SnapshotCard
        snapshot={makeSnapshot()}
        token="t"
        onRestore={noop}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /delete snapshot/i }));
    // The confirm modal's destructive action button reads "Delete".
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/instances/snapshots/snap-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
