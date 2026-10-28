// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — OSS admin tabs.
// AnnouncementsTab self-fetches /api/admin/announcements + /api/admin/pools on
// mount, renders a table, and POSTs {action} for create/update/delete/toggle.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AnnouncementsTab } from "@/app/admin/components/AnnouncementsTab";

type Json = Record<string, unknown>;

function makeFetch() {
  // announcements GET, pools GET, then everything else (POST refreshes etc.)
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/announcements" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: announcements }) });
    }
    if (url === "/api/admin/pools") {
      return Promise.resolve({ ok: true, json: async () => ({ data: { pools } }) });
    }
    // POST mutations
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let announcements: Json[] = [];
let pools: Json[] = [];

beforeEach(() => {
  vi.unstubAllGlobals();
  announcements = [];
  pools = [{ id: 1, name: "alpha-pool" }, { id: 2, name: "beta-pool" }];
});

const sampleAnnouncement = (over: Json = {}): Json => ({
  id: "ann-1",
  title: "Scheduled Maintenance",
  message: "Down tonight 10pm",
  displayType: "banner",
  targetType: "all",
  targetPoolIds: null,
  active: true,
  dismissible: true,
  startsAt: null,
  expiresAt: null,
  createdBy: "admin",
  updatedBy: "admin",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("AnnouncementsTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<AnnouncementsTab />);
    expect(screen.getByText(/loading announcements/i)).toBeInTheDocument();
  });

  it("renders the empty state when the API returns no announcements", async () => {
    makeFetch();
    render(<AnnouncementsTab />);
    expect(await screen.findByText(/no announcements yet/i)).toBeInTheDocument();
  });

  it("fetches announcements and pools on mount", async () => {
    const fetchMock = makeFetch();
    render(<AnnouncementsTab />);
    await screen.findByText(/no announcements yet/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/announcements");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pools");
  });

  it("renders the announcement row with its title, display type and status", async () => {
    announcements = [sampleAnnouncement()];
    makeFetch();
    render(<AnnouncementsTab />);
    expect(await screen.findByText("Scheduled Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
    expect(screen.getByText("All Customers")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("opens the create modal and submits a POST with action=create", async () => {
    const fetchMock = makeFetch();
    render(<AnnouncementsTab />);
    await screen.findByText(/no announcements yet/i);

    fireEvent.click(screen.getByRole("button", { name: /create announcement/i }));
    // Modal heading
    expect(screen.getByRole("heading", { name: /create announcement/i })).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText("Scheduled Maintenance Tonight");
    fireEvent.change(titleInput, { target: { value: "New Banner" } });
    fireEvent.change(screen.getByPlaceholderText(/we will be performing/i), {
      target: { value: "Hello world" },
    });
    // Submit the modal form (onSubmit={handleSave}).
    fireEvent.submit(titleInput.closest("form")!);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/announcements" && c[1]?.method === "POST"
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body.action).toBe("create");
      expect(body.title).toBe("New Banner");
      expect(body.message).toBe("Hello world");
    });
  });

  it("opens the edit modal prefilled and submits action=update with the id", async () => {
    announcements = [sampleAnnouncement()];
    const fetchMock = makeFetch();
    render(<AnnouncementsTab />);
    await screen.findByText("Scheduled Maintenance");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("heading", { name: /edit announcement/i })).toBeInTheDocument();
    // prefilled title
    expect(screen.getByDisplayValue("Scheduled Maintenance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /update announcement/i }));
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/announcements" && c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "update"
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1]!.body as string).id).toBe("ann-1");
    });
  });

  it("toggles active state via a POST with action=update and inverted active", async () => {
    announcements = [sampleAnnouncement({ active: true })];
    const fetchMock = makeFetch();
    render(<AnnouncementsTab />);
    await screen.findByText("Scheduled Maintenance");

    fireEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "update" &&
          JSON.parse((c[1]!.body as string)).active === false
      );
      expect(call).toBeTruthy();
    });
  });

  it("confirms before deleting and POSTs action=delete", async () => {
    announcements = [sampleAnnouncement()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnnouncementsTab />);
    await screen.findByText("Scheduled Maintenance");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "delete"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).id).toBe("ann-1");
    });
    confirmSpy.mockRestore();
  });

  it("does NOT delete when the confirm dialog is cancelled", async () => {
    announcements = [sampleAnnouncement()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AnnouncementsTab />);
    await screen.findByText("Scheduled Maintenance");

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "delete"
      )
    ).toBe(false);
    confirmSpy.mockRestore();
  });

  it("renders a pool-targeted announcement's target label from the pool names", async () => {
    announcements = [
      sampleAnnouncement({ targetType: "pools", targetPoolIds: JSON.stringify([1, 2]) }),
    ];
    makeFetch();
    render(<AnnouncementsTab />);
    await screen.findByText("Scheduled Maintenance");
    expect(await screen.findByText("alpha-pool, beta-pool")).toBeInTheDocument();
  });

  it("survives a non-success announcements response without crashing", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/admin/announcements") {
        return Promise.resolve({ ok: true, json: async () => ({ success: false, error: "boom" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: { pools: [] } }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AnnouncementsTab />);
    // loading clears (finally) → empty state since announcements stayed []
    expect(await screen.findByText(/no announcements yet/i)).toBeInTheDocument();
  });
});
