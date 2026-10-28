// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): DashboardAnnouncements — fetches
// /api/dashboard/announcements and renders banner/modal announcements,
// honouring dismissibility and persisting dismissals to localStorage.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DashboardAnnouncements } from "@/app/dashboard/components/DashboardAnnouncements";

function stubFetch(announcements: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ announcements }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("DashboardAnnouncements", () => {
  it("renders a banner announcement from the API", async () => {
    stubFetch([
      { id: "a1", title: "Maintenance", message: "Scheduled tonight", displayType: "banner", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => expect(screen.getByText("Maintenance")).toBeInTheDocument());
    expect(screen.getByText("Scheduled tonight")).toBeInTheDocument();
  });

  it("fetches with the auth header", async () => {
    const fetchMock = stubFetch([]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/dashboard/announcements");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
  });

  it("renders nothing when there are no announcements", async () => {
    const fetchMock = stubFetch([]);
    const { container } = render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses a banner and persists the id to localStorage", async () => {
    stubFetch([
      { id: "a1", title: "Maintenance", message: "msg", displayType: "banner", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getByText("Maintenance"));

    fireEvent.click(screen.getByRole("button", { name: /dismiss announcement/i }));
    await waitFor(() => expect(screen.queryByText("Maintenance")).not.toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem("dismissed_announcements") || "[]");
    expect(stored).toContain("a1");
  });

  it("does not render an announcement that was already dismissed", async () => {
    localStorage.setItem("dismissed_announcements", JSON.stringify(["a1"]));
    const fetchMock = stubFetch([
      { id: "a1", title: "Old news", message: "msg", displayType: "banner", dismissible: true },
    ]);
    const { container } = render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Old news")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("does not show a dismiss button for a non-dismissible banner", async () => {
    stubFetch([
      { id: "a1", title: "Permanent", message: "msg", displayType: "banner", dismissible: false },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getByText("Permanent"));
    expect(screen.queryByRole("button", { name: /dismiss announcement/i })).not.toBeInTheDocument();
  });

  it("renders a modal announcement with a 'Got it' button", async () => {
    stubFetch([
      { id: "m1", title: "Welcome", message: "Read me", displayType: "modal", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getByText("Welcome"));
    expect(screen.getByRole("button", { name: /got it/i })).toBeInTheDocument();
  });

  it("closes a modal announcement when 'Got it' is clicked", async () => {
    stubFetch([
      { id: "m1", title: "Welcome", message: "Read me", displayType: "modal", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /got it/i }));

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.queryByText("Welcome")).not.toBeInTheDocument());
  });

  it("renders a 'both' announcement as both a banner and a modal", async () => {
    stubFetch([
      { id: "b1", title: "Big news", message: "Everywhere", displayType: "both", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getAllByText("Big news"));
    // banner copy + modal copy => the title appears twice
    expect(screen.getAllByText("Big news").length).toBe(2);
  });

  it("keeps a 'both' announcement's banner after its modal is closed", async () => {
    stubFetch([
      { id: "b1", title: "Big news", message: "Everywhere", displayType: "both", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /got it/i }));

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(screen.getAllByText("Big news").length).toBe(1));
    expect(screen.queryByRole("button", { name: /got it/i })).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("dismissed_announcements") || "[]")
    ).not.toContain("b1");
    expect(
      JSON.parse(localStorage.getItem("shown_announcement_modals") || "[]")
    ).toContain("b1");
  });

  it("shows a 'both' announcement's banner without re-opening a modal already seen", async () => {
    localStorage.setItem("shown_announcement_modals", JSON.stringify(["b1"]));
    stubFetch([
      { id: "b1", title: "Big news", message: "Everywhere", displayType: "both", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getAllByText("Big news"));
    expect(screen.getAllByText("Big news").length).toBe(1);
    expect(screen.queryByRole("button", { name: /got it/i })).not.toBeInTheDocument();
  });

  it("still retires a modal-only announcement when it is closed", async () => {
    stubFetch([
      { id: "m1", title: "Welcome", message: "Read me", displayType: "modal", dismissible: true },
    ]);
    render(<DashboardAnnouncements token="test-token" />);
    await waitFor(() => screen.getByRole("button", { name: /got it/i }));

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.queryByText("Welcome")).not.toBeInTheDocument());
    expect(
      JSON.parse(localStorage.getItem("dismissed_announcements") || "[]")
    ).toContain("m1");
  });
});
