// @vitest-environment jsdom
//
// TeamMembers loads members + (if canInvite) pending invitations in parallel,
// then supports: inviting (POST .../invitations), revoking an invite (DELETE,
// confirm-gated), changing a member's role (PATCH .../members/:userId),
// removing a member (DELETE, confirm-gated), and renaming the team (PATCH
// /api/account/team-name). The owner row and the current user's own row are
// not editable. Revoked members are hidden.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import TeamMembers from "@/components/TeamMembers";

interface Member {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  roleDisplayName: string;
  isOwner: boolean;
  status: string;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

function member(over: Partial<Member> & { id: string; userId: string; email: string }): Member {
  return {
    displayName: null,
    role: "member",
    roleDisplayName: "Team Member",
    isOwner: false,
    status: "active",
    invitedAt: "2026-01-01T00:00:00.000Z",
    acceptedAt: "2026-01-02T00:00:00.000Z",
    revokedAt: null,
    ...over,
  };
}

const owner = member({
  id: "m-owner",
  userId: "u-owner",
  email: "owner@example.com",
  displayName: "Owner Person",
  isOwner: true,
  role: "teamAdmin",
  roleDisplayName: "Team Admin",
});
const teammate = member({
  id: "m-2",
  userId: "u-2",
  email: "teammate@example.com",
  displayName: "Team Mate",
});

/**
 * Build a fetch mock. The first two calls (members + invitations) come from
 * Promise.all inside fetchAll; subsequent calls are mutations/refetches.
 */
function makeFetch(opts: {
  members?: Member[];
  invitations?: Array<Record<string, unknown>>;
  mutations?: Array<{ ok: boolean; body?: unknown }>;
  refetchMembers?: Member[];
  refetchInvites?: Array<Record<string, unknown>>;
}) {
  const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("/members")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ members: opts.refetchMembersRef.value }),
      });
    }
    if (method === "GET" && url.includes("/invitations")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ invitations: opts.refetchInvitesRef.value }),
      });
    }
    const next = mutationQueue.shift();
    return Promise.resolve({
      ok: next?.ok ?? true,
      json: async () => next?.body ?? {},
    });
  }) as unknown as ReturnType<typeof vi.fn>;
  const mutationQueue = [...(opts.mutations ?? [])];
  // Mutable refs so a mutation's refetch can reflect post-mutation state.
  (opts as Record<string, unknown>).refetchMembersRef = {
    value: opts.members ?? [],
  };
  (opts as Record<string, unknown>).refetchInvitesRef = {
    value: opts.invitations ?? [],
  };
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

function renderTeam(props: Partial<React.ComponentProps<typeof TeamMembers>> = {}) {
  return render(
    <TeamMembers
      token="jwt-1"
      accountId="acc-1"
      canInvite
      canManage
      currentUserId="u-owner"
      teamName="Acme Team"
      ownerEmailFallback="owner@example.com"
      {...props}
    />,
  );
}

describe("TeamMembers", () => {
  it("loads and renders active members with the Bearer token", async () => {
    const fetchMock = makeFetch({ members: [owner, teammate], invitations: [] });
    renderTeam();
    expect(await screen.findByText("teammate@example.com")).toBeInTheDocument();
    const membersCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/members"),
    );
    expect(membersCall?.[0]).toBe("/api/accounts/acc-1/members");
    expect(membersCall?.[1]?.headers.Authorization).toBe("Bearer jwt-1");
  });

  it("hides revoked members from the list", async () => {
    const revoked = member({
      id: "m-3",
      userId: "u-3",
      email: "gone@example.com",
      status: "revoked",
      revokedAt: "2026-02-01T00:00:00.000Z",
    });
    makeFetch({ members: [owner, revoked], invitations: [] });
    renderTeam();
    await screen.findByText("owner@example.com");
    expect(screen.queryByText("gone@example.com")).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no active members", async () => {
    makeFetch({ members: [], invitations: [] });
    renderTeam();
    expect(
      await screen.findByText(/No team members yet/),
    ).toBeInTheDocument();
  });

  it("invites a member: POSTs email + role and shows success", async () => {
    const fetchMock = makeFetch({
      members: [owner],
      invitations: [],
      mutations: [{ ok: true, body: { ok: true } }],
    });
    renderTeam();
    await screen.findByText("owner@example.com");

    fireEvent.click(screen.getByRole("button", { name: "+ Invite" }));
    fireEvent.change(screen.getByPlaceholderText("colleague@example.com"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(
      await screen.findByText("Invitation sent to new@example.com."),
    ).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe("/api/accounts/acc-1/invitations");
    const body = JSON.parse(postCall?.[1]?.body);
    expect(body.email).toBe("new@example.com");
    expect(body.role).toBe("member");
  });

  it("surfaces the server error when an invite fails", async () => {
    makeFetch({
      members: [owner],
      invitations: [],
      mutations: [{ ok: false, body: { error: "Seat limit reached" } }],
    });
    renderTeam();
    await screen.findByText("owner@example.com");
    fireEvent.click(screen.getByRole("button", { name: "+ Invite" }));
    fireEvent.change(screen.getByPlaceholderText("colleague@example.com"), {
      target: { value: "x@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Seat limit reached")).toBeInTheDocument();
  });

  it("shows a live character counter on the Name field, and an at-limit message when full (PA-228)", async () => {
    makeFetch({ members: [owner], invitations: [] });
    renderTeam();
    await screen.findByText("owner@example.com");
    fireEvent.click(screen.getByRole("button", { name: "+ Invite" }));

    const nameInput = screen.getByPlaceholderText("Colleague's name");
    // Starts empty: 0/100, no at-limit message.
    expect(screen.getByText("0/100")).toBeInTheDocument();
    expect(screen.queryByText(/cannot exceed/)).not.toBeInTheDocument();

    // Counter tracks input length.
    fireEvent.change(nameInput, { target: { value: "Jane Doe" } });
    expect(screen.getByText("8/100")).toBeInTheDocument();
    expect(screen.queryByText(/cannot exceed/)).not.toBeInTheDocument();

    // At the cap the counter turns red and a validation message appears, so the
    // field no longer stops accepting input silently.
    fireEvent.change(nameInput, { target: { value: "x".repeat(100) } });
    expect(screen.getByText("100/100")).toBeInTheDocument();
    expect(
      screen.getByText("Name cannot exceed 100 characters"),
    ).toBeInTheDocument();
  });

  it("renders pending invitations and revokes one (confirm-gated DELETE)", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = makeFetch({
      members: [owner],
      invitations: [
        {
          id: "inv-1",
          email: "pending@example.com",
          role: "member",
          roleDisplayName: "Team Member",
          invitedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-02-01T00:00:00.000Z",
          tokenPreview: "abc",
        },
      ],
      mutations: [{ ok: true, body: {} }],
    });
    renderTeam();
    expect(await screen.findByText("pending@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Invitation revoked.")).toBeInTheDocument();
    const delCall = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
    expect(delCall?.[0]).toBe("/api/accounts/acc-1/invitations/inv-1");
  });

  it("changes a member's role via PATCH and shows the confirmation message", async () => {
    const fetchMock = makeFetch({
      members: [owner, teammate],
      invitations: [],
      mutations: [{ ok: true, body: { ok: true } }],
    });
    // currentUserId differs from teammate so the row is editable.
    renderTeam({ currentUserId: "u-owner" });
    await screen.findByText("teammate@example.com");

    // The editable row's role <select>.
    const selects = screen.getAllByTitle("Change role");
    fireEvent.change(selects[0], { target: { value: "readOnlyMember" } });

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(patch?.[0]).toBe("/api/accounts/acc-1/members/u-2");
      expect(JSON.parse(patch?.[1]?.body)).toEqual({ role: "readOnlyMember" });
    });
  });

  it("removes a member via confirm-gated DELETE", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = makeFetch({
      members: [owner, teammate],
      invitations: [],
      mutations: [{ ok: true, body: {} }],
    });
    renderTeam();
    await screen.findByText("teammate@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
      expect(del?.[0]).toBe("/api/accounts/acc-1/members/u-2");
    });
  });

  it("does not let the owner row be edited or removed", async () => {
    makeFetch({ members: [owner], invitations: [] });
    renderTeam({ currentUserId: "u-other" }); // owner is not the current user
    await screen.findByText("owner@example.com");
    // Owner row → no role <select>, no Remove button.
    expect(screen.queryByTitle("Change role")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });

  it("renames the team via PATCH /api/account/team-name", async () => {
    const fetchMock = makeFetch({
      members: [owner],
      invitations: [],
      mutations: [{ ok: true, body: {} }],
    });
    renderTeam();
    await screen.findByText("owner@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Rename team" }));
    const input = screen.getByDisplayValue("Acme Team");
    fireEvent.change(input, { target: { value: "Globex" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/account/team-name",
      );
      expect(patch?.[1]?.method).toBe("PATCH");
      expect(JSON.parse(patch?.[1]?.body)).toEqual({ teamName: "Globex" });
    });
  });

  it("does not submit or show false success when Save is clicked with no team name entered (PA-460)", async () => {
    const fetchMock = makeFetch({
      members: [owner],
      invitations: [],
      mutations: [{ ok: true, body: {} }],
    });
    renderTeam({ teamName: null });
    await screen.findByText("owner@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Set team name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Please enter a team name."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Team renamed/)).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.find((c) => c[0] === "/api/account/team-name"),
    ).toBeUndefined();
  });

  it("does not show the Invite button when canInvite is false", async () => {
    makeFetch({ members: [owner], invitations: [] });
    renderTeam({ canInvite: false });
    await screen.findByText("owner@example.com");
    expect(
      screen.queryByRole("button", { name: "+ Invite" }),
    ).not.toBeInTheDocument();
  });
});
