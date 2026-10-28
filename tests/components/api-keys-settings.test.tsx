// @vitest-environment jsdom
//
// ApiKeysSettings does full CRUD against /api/account/api-keys: lists keys,
// creates one (revealing the secret exactly once with a copy button), and
// deletes one behind an inline "Delete this key? Yes/Cancel" confirm. We assert
// the loading→list/empty transition, each fetch's URL + method + body, the
// one-time secret reveal, and error surfacing.
//
// The component does a fire-and-forget dynamic import("@/lib/plerdy") on
// create for analytics; we stub it so the test never touches that boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/plerdy", () => ({
  trackPlerdy: vi.fn(),
  PLERDY_EVENTS: { API_KEY_CREATED: "api_key_created" },
}));

import { ApiKeysSettings } from "@/components/ApiKeysSettings";

interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

function key(over: Partial<KeyRow> & { id: string }): KeyRow {
  return {
    name: "prod",
    keyPrefix: "pk_live_ab",
    scopes: "full",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
    expiresAt: null,
    ...over,
  };
}

function makeFetch(steps: Array<{ ok: boolean; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const s of steps) {
    fetchMock.mockResolvedValueOnce({ ok: s.ok, json: async () => s.body ?? {} });
  }
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ keys: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiKeysSettings", () => {
  it("loads keys with the Bearer token and renders them", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [key({ id: "1", name: "CI key" })] } },
    ]);
    render(<ApiKeysSettings token="jwt-1" />);
    expect(await screen.findByText("CI key")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/api-keys");
    expect(init.headers.Authorization).toBe("Bearer jwt-1");
  });

  it("renders the empty state when there are no keys", async () => {
    makeFetch([{ ok: true, body: { keys: [] } }]);
    render(<ApiKeysSettings token="t" />);
    expect(await screen.findByText("No API keys yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create your first API key" }),
    ).toBeInTheDocument();
  });

  it("surfaces an error when the initial load fails", async () => {
    makeFetch([{ ok: false, body: {} }]);
    render(<ApiKeysSettings token="t" />);
    expect(
      await screen.findByText("Failed to fetch API keys"),
    ).toBeInTheDocument();
  });

  it("opens the create modal and disables Create until a name is typed", async () => {
    makeFetch([{ ok: true, body: { keys: [] } }]);
    render(<ApiKeysSettings token="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Key" }));

    // Modal is open → the header trigger AND the modal submit both read
    // "Create Key"; the submit is the last one.
    const createBtn = screen.getAllByRole("button", { name: "Create Key" }).pop()!;
    expect(createBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Key Name"), {
      target: { value: "My key" },
    });
    expect(createBtn).toBeEnabled();
  });

  it("creates a key, POSTs the name, and reveals the secret once", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [] } }, // load
      { ok: true, body: { apiKey: { id: "n", name: "My key", keyPrefix: "pk_", key: "pk_live_SECRET", scopes: "full", expiresAt: null, createdAt: "x" } } }, // POST
      { ok: true, body: { keys: [key({ id: "n", name: "My key" })] } }, // refetch
    ]);
    render(<ApiKeysSettings token="jwt-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Key" }));
    fireEvent.change(screen.getByLabelText("Key Name"), {
      target: { value: "My key" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create Key" }).pop()!,
    );

    expect(await screen.findByText("API Key Created")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pk_live_SECRET")).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe("/api/account/api-keys");
    expect(JSON.parse(postCall?.[1]?.body)).toEqual({ name: "My key" });
  });

  it("surfaces the server error when create fails", async () => {
    makeFetch([
      { ok: true, body: { keys: [] } },
      { ok: false, body: { error: "Key limit reached" } },
    ]);
    render(<ApiKeysSettings token="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Key" }));
    fireEvent.change(screen.getByLabelText("Key Name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Create Key" }).pop()!);

    expect(await screen.findByText("Key limit reached")).toBeInTheDocument();
  });

  it("deletes a key via the inline confirm and DELETE /api/account/api-keys/:id", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [key({ id: "k9", name: "Old key" })] } }, // load
      { ok: true, body: {} }, // DELETE
      { ok: true, body: { keys: [] } }, // refetch
    ]);
    render(<ApiKeysSettings token="t" />);
    await screen.findByText("Old key");

    fireEvent.click(screen.getByRole("button", { name: "Delete key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

    await waitFor(() => {
      const delCall = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
      expect(delCall?.[0]).toBe("/api/account/api-keys/k9");
    });
  });

  it("cancels the inline delete confirm without firing a DELETE", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [key({ id: "k9", name: "Old key" })] } },
    ]);
    render(<ApiKeysSettings token="t" />);
    await screen.findByText("Old key");

    fireEvent.click(screen.getByRole("button", { name: "Delete key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
  });

  it("surfaces an error when delete fails", async () => {
    makeFetch([
      { ok: true, body: { keys: [key({ id: "k9", name: "Old key" })] } },
      { ok: false, body: {} },
    ]);
    render(<ApiKeysSettings token="t" />);
    await screen.findByText("Old key");
    fireEvent.click(screen.getByRole("button", { name: "Delete key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

    expect(
      await screen.findByText("Failed to delete API key"),
    ).toBeInTheDocument();
  });
});
