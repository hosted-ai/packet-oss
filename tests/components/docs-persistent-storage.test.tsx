// @vitest-environment jsdom
//
// PA-287: PersistentStorageDoc is a static documentation panel covering
// NFS-backed persistent volumes. These tests pin the title, the key-features
// list, the mount path, the snapshot section, the survives-termination table,
// and the FAQ.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PersistentStorageDoc } from "@/app/dashboard/components/docs/PersistentStorageDoc";

describe("PersistentStorageDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<PersistentStorageDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/keep your data safe across restarts/i),
    ).toBeInTheDocument();
  });

  it("documents the adding-storage and using-storage sections", () => {
    render(<PersistentStorageDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /adding persistent storage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /using your storage/i }),
    ).toBeInTheDocument();
  });

  it("states the NFS basis of persistent storage", () => {
    render(<PersistentStorageDoc />);
    expect(screen.getByText(/NFS-Based/i)).toBeInTheDocument();
  });

  it("documents the snapshot section and its common misconception", () => {
    render(<PersistentStorageDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /snapshots and storage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /common misconception/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/bookmark \+ persistent disk/i),
    ).toBeInTheDocument();
  });

  it("contrasts persistent vs local storage in the survives-termination table", () => {
    render(<PersistentStorageDoc />);
    // Both labels appear as table-cell headings, so assert at least one of each.
    expect(screen.getAllByText("Persistent Storage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Local Storage").length).toBeGreaterThan(0);
    // The table marks one Yes (persistent) and one No (local storage) for survival.
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("answers whether storage is accessible after terminating a pod", () => {
    render(<PersistentStorageDoc />);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: /can i access storage after terminating my pod/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows the HF_HOME persistent-cache snippet", () => {
    render(<PersistentStorageDoc />);
    expect(
      screen.getByText(/export HF_HOME=\/data\/shareXX\/hf-cache/),
    ).toBeInTheDocument();
  });
});
