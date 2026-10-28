// @vitest-environment jsdom
//
// InvitationAcceptModal loads /api/invitations/<token>, shows who invited the
// user and to what role, and on accept chains POST /accept → POST
// /api/session/switch-account → navigate to /dashboard?token=<jwt>. If the
// signed-in email differs from the invite email it renders a "not for you"
// state with no Accept button. Failures surface inline; cancel strips the
// modal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { InvitationAcceptModal } from "@/components/InvitationAcceptModal";

const invite = {
  email: "invitee@example.com",
  roleDisplayName: "Team Member",
  accountLabel: "Acme",
  teamName: "Acme Team",
  invitedByEmail: "owner@example.com",
  expiresAt: "2026-12-31T00:00:00.000Z",
  alreadyAccepted: false,
};

let locationHref: { value: string };

beforeEach(() => {
  vi.unstubAllGlobals();
  locationHref = { value: "https://app.test/dashboard?invite=tok" };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "https://app.test",
      get href() {
        return locationHref.value;
      },
      set href(v: string) {
        locationHref.value = v;
      },
      reload: vi.fn(),
    },
  });
  // history.replaceState is used by stripInviteFromUrl; jsdom provides it.
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});

function makeFetch(steps: Array<{ ok: boolean; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const s of steps) {
    fetchMock.mockResolvedValueOnce({ ok: s.ok, json: async () => s.body ?? {} });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("InvitationAcceptModal", () => {
  it("loads the invitation and shows the inviter, team, and role", async () => {
    const fetchMock = makeFetch([{ ok: true, body: invite }]);
    render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="invitee@example.com"
      />,
    );
    expect(await screen.findByText("Accept invitation")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("Acme Team")).toBeInTheDocument();
    expect(screen.getByText("Team Member")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/invitations/tok");
  });

  it("shows a 'not for you' state with no Accept button on email mismatch", async () => {
    makeFetch([{ ok: true, body: invite }]);
    render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="someone-else@example.com"
      />,
    );
    expect(
      await screen.findByText("Invitation not for you"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept invitation/ }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a server error when the invitation fails to load", async () => {
    makeFetch([{ ok: false, body: { error: "Invitation expired" } }]);
    render(
      <InvitationAcceptModal token="tok" jwt="jwt-1" userEmail="x@example.com" />,
    );
    expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss" }),
    ).toBeInTheDocument();
  });

  it("accepts: POSTs /accept then switch-account and navigates to the new token", async () => {
    const fetchMock = makeFetch([
      { ok: true, body: invite }, // load
      { ok: true, body: { success: true, accountId: "acc-9" } }, // accept
      { ok: true, body: { token: "switched-jwt" } }, // switch
    ]);
    render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="invitee@example.com"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept invitation" }),
    );

    await waitFor(() =>
      expect(locationHref.value).toBe("/dashboard?token=switched-jwt"),
    );

    const acceptCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/invitations/tok/accept",
    );
    expect(acceptCall?.[1]?.method).toBe("POST");
    expect(acceptCall?.[1]?.headers.Authorization).toBe("Bearer jwt-1");

    const switchCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/session/switch-account",
    );
    expect(JSON.parse(switchCall?.[1]?.body)).toEqual({ accountId: "acc-9" });
  });

  it("surfaces the accept error when /accept returns no accountId", async () => {
    makeFetch([
      { ok: true, body: invite },
      { ok: false, body: { error: "Already a member elsewhere" } },
    ]);
    render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="invitee@example.com"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept invitation" }),
    );
    expect(
      await screen.findByText("Already a member elsewhere"),
    ).toBeInTheDocument();
    expect(locationHref.value).toBe("https://app.test/dashboard?invite=tok");
  });

  it("reloads in place when accept succeeds but switch-account fails", async () => {
    makeFetch([
      { ok: true, body: invite },
      { ok: true, body: { success: true, accountId: "acc-9" } },
      { ok: false, body: {} }, // switch fails
    ]);
    render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="invitee@example.com"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept invitation" }),
    );
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
  });

  it("shows the already-accepted notice when the invite was used before", async () => {
    makeFetch([{ ok: true, body: { ...invite, alreadyAccepted: true } }]);
    render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="invitee@example.com"
      />,
    );
    expect(
      await screen.findByText(/already been used/),
    ).toBeInTheDocument();
  });

  it("dismisses the modal on cancel (strips ?invite= and renders nothing)", async () => {
    makeFetch([{ ok: true, body: invite }]);
    const { container } = render(
      <InvitationAcceptModal
        token="tok"
        jwt="jwt-1"
        userEmail="invitee@example.com"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(window.history.replaceState).toHaveBeenCalled();
  });
});
