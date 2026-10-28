// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — EmailTemplatesTab.
// Self-fetches /api/admin/email-templates, renders active + available (code
// default) templates, edits/creates via PUT/POST, deletes, and previews. The
// inline preview uses an <iframe srcDoc> (no premium EmailPreviewModal import).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { EmailTemplatesTab } from "@/app/admin/components/EmailTemplatesTab";

type Json = Record<string, unknown>;

let templates: Json[];

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/email-templates" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: templates }) });
    }
    if (url.startsWith("/api/admin/email-templates/defaults")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ subject: "Default subject", html: "<p>default</p>", text: "" }),
      });
    }
    if (url === "/api/admin/platform-settings") {
      return Promise.resolve({ ok: true, json: async () => ({ services: { email: { settings: {} } } }) });
    }
    // PUT / POST / DELETE
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleTemplate = (over: Json = {}): Json => ({
  id: "tpl-1",
  slug: "signup-welcome",
  name: "Signup Welcome",
  description: "Sent after signup",
  subject: "Your account is ready",
  htmlContent: "<p>Hi {{customerName}}</p>",
  textContent: null,
  variables: JSON.stringify(["customerName", "dashboardUrl"]),
  active: true,
  updatedBy: "admin",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  templates = [];
});

describe("EmailTemplatesTab", () => {
  it("shows a loading spinner before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<EmailTemplatesTab />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("fetches templates on mount", async () => {
    const fetchMock = makeFetch();
    render(<EmailTemplatesTab />);
    await screen.findByText(/configure email sender settings/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/email-templates");
  });

  it("lists active templates returned by the API", async () => {
    templates = [sampleTemplate()];
    makeFetch();
    render(<EmailTemplatesTab />);
    expect(await screen.findByText(/active templates \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Signup Welcome")).toBeInTheDocument();
    expect(screen.getByText(/subject: your account is ready/i)).toBeInTheDocument();
  });

  it("lists available (code-default) templates that have not been created", async () => {
    makeFetch();
    render(<EmailTemplatesTab />);
    await screen.findByText(/available templates/i);
    // None created → the well-known defaults appear as customizable.
    expect(screen.getAllByText(/using code default/i).length).toBeGreaterThan(0);
  });

  it("opens the editor prefilled when an active template's Edit is clicked", async () => {
    templates = [sampleTemplate()];
    makeFetch();
    render(<EmailTemplatesTab />);
    await screen.findByText("Signup Welcome");

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(await screen.findByText(/edit: signup welcome/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Your account is ready")).toBeInTheDocument();
    expect(screen.getByDisplayValue("<p>Hi {{customerName}}</p>")).toBeInTheDocument();
  });

  it("PUTs to the slug endpoint when saving an edited template", async () => {
    templates = [sampleTemplate()];
    const fetchMock = makeFetch();
    render(<EmailTemplatesTab />);
    await screen.findByText("Signup Welcome");

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    await screen.findByText(/edit: signup welcome/i);
    fireEvent.click(screen.getByRole("button", { name: /save template/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => (c[0] as string) === "/api/admin/email-templates/signup-welcome" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
    });
  });

  it("fetches the server default HTML when customizing an available template", async () => {
    makeFetch();
    const fetchMock = makeFetch();
    render(<EmailTemplatesTab />);
    await screen.findByText(/available templates/i);

    fireEvent.click(screen.getAllByRole("button", { name: /customize/i })[0]);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => (c[0] as string).startsWith("/api/admin/email-templates/defaults?slug="))
      ).toBe(true);
    });
    // The editor opens in create mode.
    expect(await screen.findByText(/^Create:/i)).toBeInTheDocument();
  });

  it("renders an inline iframe preview with substituted sample data", async () => {
    templates = [sampleTemplate()];
    makeFetch();
    const { container } = render(<EmailTemplatesTab />);
    await screen.findByText("Signup Welcome");

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    await screen.findByText(/edit: signup welcome/i);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => {
      const iframe = container.querySelector('iframe[title="Email Preview"]') as HTMLIFrameElement;
      expect(iframe).toBeTruthy();
      // {{customerName}} replaced with sample "John Doe".
      expect(iframe.getAttribute("srcdoc")).toContain("John Doe");
    });
  });

  it("DELETEs a template after confirmation", async () => {
    templates = [sampleTemplate()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EmailTemplatesTab />);
    await screen.findByText("Signup Welcome");

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => (c[0] as string) === "/api/admin/email-templates/signup-welcome" && c[1]?.method === "DELETE"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("does not DELETE when confirm is cancelled", async () => {
    templates = [sampleTemplate()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EmailTemplatesTab />);
    await screen.findByText("Signup Welcome");

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(
      fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")
    ).toBe(false);
    confirmSpy.mockRestore();
  });
});
