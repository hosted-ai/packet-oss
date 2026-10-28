// @vitest-environment jsdom
//
// SSHKeys lists /api/account/ssh-keys, adds a key (POST), and deletes one
// (DELETE ?id=, guarded by window.confirm). It shows a success banner after
// add/delete, surfaces server errors, hides the "Add Key" button at the 10-key
// cap, and renders an empty-state message when there are none.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import SSHKeys from "@/components/SSHKeys";

interface KeyRow {
  id: string;
  name: string;
  fingerprint: string;
  createdAt: string;
  keyPreview: string;
}

function key(over: Partial<KeyRow> & { id: string }): KeyRow {
  return {
    name: "laptop",
    fingerprint: "SHA256:abcd",
    createdAt: "2026-01-01T00:00:00.000Z",
    keyPreview: "ssh-ed25519 AAAA",
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

describe("SSHKeys", () => {
  it("loads and renders the existing keys with the Bearer token", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [key({ id: "1", name: "MacBook" })] } },
    ]);
    render(<SSHKeys token="jwt-1" />);
    expect(await screen.findByText("MacBook")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/ssh-keys");
    expect(init.headers.Authorization).toBe("Bearer jwt-1");
  });

  it("shows the empty-state message when there are no keys", async () => {
    makeFetch([{ ok: true, body: { keys: [] } }]);
    render(<SSHKeys token="t" />);
    expect(
      await screen.findByText(/No SSH keys yet/),
    ).toBeInTheDocument();
  });

  it("reveals the add form when 'Add Key' is clicked", async () => {
    makeFetch([{ ok: true, body: { keys: [] } }]);
    render(<SSHKeys token="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add Key" }));
    expect(screen.getByPlaceholderText("My MacBook")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/ssh-ed25519 AAAA/),
    ).toBeInTheDocument();
  });

  it("POSTs a new key with name + publicKey and shows the success banner", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [] } }, // initial load
      { ok: true, body: { id: "new" } }, // POST
      { ok: true, body: { keys: [key({ id: "new", name: "Work" })] } }, // refetch
    ]);
    render(<SSHKeys token="jwt-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add Key" }));

    fireEvent.change(screen.getByPlaceholderText("My MacBook"), {
      target: { value: "Work" },
    });
    fireEvent.change(screen.getByPlaceholderText(/ssh-ed25519 AAAA/), {
      target: { value: "ssh-ed25519 AAAAB3Nz work@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Key" }));

    expect(
      await screen.findByText('SSH key "Work" added successfully'),
    ).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST",
    );
    expect(postCall?.[0]).toBe("/api/account/ssh-keys");
    expect(JSON.parse(postCall?.[1]?.body)).toEqual({
      name: "Work",
      publicKey: "ssh-ed25519 AAAAB3Nz work@example.com",
    });
  });

  it("surfaces the server error when adding a key fails", async () => {
    makeFetch([
      { ok: true, body: { keys: [] } },
      { ok: false, body: { error: "Invalid public key" } },
    ]);
    render(<SSHKeys token="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add Key" }));
    fireEvent.change(screen.getByPlaceholderText("My MacBook"), {
      target: { value: "Bad" },
    });
    fireEvent.change(screen.getByPlaceholderText(/ssh-ed25519 AAAA/), {
      target: { value: "not-a-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Key" }));

    expect(await screen.findByText("Invalid public key")).toBeInTheDocument();
  });

  it("deletes a key (with confirm) via DELETE ?id= and shows the success banner", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [key({ id: "k1", name: "Old" })] } }, // load
      { ok: true, body: {} }, // DELETE
      { ok: true, body: { keys: [] } }, // refetch
    ]);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<SSHKeys token="t" />);
    await screen.findByText("Old");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText('SSH key "Old" deleted')).toBeInTheDocument();
    const delCall = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
    expect(delCall?.[0]).toBe("/api/account/ssh-keys?id=k1");
  });

  it("does not delete when the user cancels the confirm", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: { keys: [key({ id: "k1", name: "Old" })] } },
    ]);
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<SSHKeys token="t" />);
    await screen.findByText("Old");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
  });

  it("hides 'Add Key' once the 10-key cap is reached", async () => {
    const tenKeys = Array.from({ length: 10 }, (_, i) =>
      key({ id: String(i), name: `key-${i}` }),
    );
    makeFetch([{ ok: true, body: { keys: tenKeys } }]);
    render(<SSHKeys token="t" />);
    await screen.findByText("key-0");
    expect(
      screen.queryByRole("button", { name: "+ Add Key" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Maximum of 10 keys reached/)).toBeInTheDocument();
  });
});
