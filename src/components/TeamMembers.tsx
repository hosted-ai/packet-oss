"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PACKET_ROLES, ROLE_PERMISSIONS, type PacketRole } from "@/lib/auth/role-permissions";
import { trackEvent } from "@/lib/analytics/track-event";

interface MemberRow {
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

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  roleDisplayName: string;
  invitedAt: string;
  expiresAt: string;
  tokenPreview: string;
}

interface TeamMembersProps {
  token: string;
  accountId: string;
  canInvite: boolean;
  canManage: boolean;
  currentUserId: string | null;
  /** Current team display name (from CustomerSettings.teamName). Null = no override set. */
  teamName?: string | null;
  /** Fallback display label if teamName is null (typically the Stripe customer email). */
  ownerEmailFallback?: string | null;
}

// Order roles for the dropdown: most-privileged first.
const ROLE_ORDER: PacketRole[] = [
  "teamAdmin",
  "member",
  "readOnlyMember",
  "financeManager",
];

// PA-228: invite Name length cap. Mirrors the server's MAX_INVITEE_NAME_LEN
// (src/app/api/accounts/[accountId]/invitations/route.ts) so the input's
// maxLength, the live counter, and the at-limit message never drift apart.
const INVITE_NAME_MAX_LENGTH = 100;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function activeMembersCountLabel(members: { status: string }[]): string {
  const active = members.filter((m) => m.status !== "revoked").length;
  return `${active} member${active === 1 ? "" : "s"}`;
}

function roleBadgeClasses(): string {
  // PA-202 visual constraint: no role-icon-in-colored-circle, no emoji. Plain
  // text badge with a subtle background. Keep all roles the same colour — the
  // text does the work.
  return "ml-2 text-xs bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-medium";
}

export default function TeamMembers({
  token,
  accountId,
  canInvite,
  canManage,
  currentUserId,
  teamName,
  ownerEmailFallback,
}: TeamMembersProps) {
  const [renameValue, setRenameValue] = useState<string>(teamName ?? "");
  const [renaming, setRenaming] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  // Re-sync local input when verify refresh swaps in a new teamName from props.
  useEffect(() => {
    setRenameValue(teamName ?? "");
  }, [teamName]);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = renameValue.trim();
    // PA-460: an empty field with no existing team name is a no-op (nothing
    // to clear), so don't submit it and claim success.
    if (trimmed === "" && !teamName) {
      setSuccess(null);
      setError("Please enter a team name.");
      return;
    }
    setRenaming(true);
    setError(null);
    try {
      const res = await fetch("/api/account/team-name", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ teamName: trimmed === "" ? null : trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to rename team.");
      }
      setSuccess("Team renamed. Refresh to see the new name everywhere.");
      setRenameOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename team.");
    } finally {
      setRenaming(false);
    }
  }
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<PacketRole>("member");
  const [inviting, setInviting] = useState(false);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`/api/accounts/${accountId}/members`, { headers }),
        canInvite
          ? fetch(`/api/accounts/${accountId}/invitations`, { headers })
          : Promise.resolve(null),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members ?? []);
      }
      if (invitesRes && invitesRes.ok) {
        const data = await invitesRes.json();
        setInvitations(data.invitations ?? []);
      }
    } catch (err) {
      console.error("[TeamMembers] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId, canInvite, headers]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setInviting(true);

    try {
      const res = await fetch(`/api/accounts/${accountId}/invitations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          inviteeName: inviteName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send invitation");

      // GA4: team invite sent successfully
      trackEvent("team_invite_sent");

      setSuccess(`Invitation sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      setShowInviteForm(false);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!confirm("Revoke this pending invitation?")) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/invitations/${invitationId}`,
        { method: "DELETE", headers },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to revoke invitation");
      }
      setSuccess("Invitation revoked.");
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invitation");
    }
  };

  const handleRoleChange = async (member: MemberRow, newRole: PacketRole) => {
    if (member.role === newRole) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/members/${member.userId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ role: newRole }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change role");
      setSuccess(`Updated ${member.email}'s role to ${ROLE_PERMISSIONS[newRole].displayName}.`);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    }
  };

  const handleRemove = async (member: MemberRow) => {
    if (!confirm(`Remove ${member.email} from the team?`)) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/members/${member.userId}`,
        { method: "DELETE", headers },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove member");
      }
      setSuccess(`${member.email} removed.`);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  // Hide revoked members from the main list.
  const activeMembers = members.filter((m) => m.status !== "revoked");

  return (
    <div className="border border-zinc-200 rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-900 truncate">
            {teamName || ownerEmailFallback || "Team Members"}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500">
              {activeMembersCountLabel(members)}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => setRenameOpen((v) => !v)}
                className="text-xs text-purple-600 hover:text-purple-700"
              >
                {renameOpen ? "Cancel" : teamName ? "Rename team" : "Set team name"}
              </button>
            )}
          </div>
        </div>
        {canInvite && !showInviteForm && (
          <button
            onClick={() => setShowInviteForm(true)}
            className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shrink-0"
          >
            + Invite
          </button>
        )}
      </div>

      {renameOpen && canManage && (
        <form onSubmit={handleRename} className="mb-4 flex gap-2">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={ownerEmailFallback || "Team name"}
            maxLength={80}
            className="flex-1 px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
            autoFocus
          />
          <button
            type="submit"
            disabled={renaming}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 text-sm"
          >
            {renaming ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Invite form */}
      {showInviteForm && canInvite && (
        <form onSubmit={handleInvite} className="mb-4 p-4 bg-zinc-50 rounded-lg">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Email address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                maxLength={254}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Name <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Colleague's name"
                maxLength={INVITE_NAME_MAX_LENGTH}
                aria-describedby="invite-name-counter"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              {/* PA-228: give live feedback so the field no longer stops accepting
                  input silently — a counter that turns into an at-limit message. */}
              <div id="invite-name-counter" className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs text-red-600" role="alert">
                  {inviteName.length >= INVITE_NAME_MAX_LENGTH
                    ? `Name cannot exceed ${INVITE_NAME_MAX_LENGTH} characters`
                    : " "}
                </p>
                <p
                  className={`text-xs tabular-nums ${
                    inviteName.length >= INVITE_NAME_MAX_LENGTH ? "text-red-600" : "text-zinc-500"
                  }`}
                >
                  {inviteName.length}/{INVITE_NAME_MAX_LENGTH}
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as PacketRole)}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_PERMISSIONS[r].displayName}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-zinc-600 leading-relaxed">
                {ROLE_PERMISSIONS[inviteRole].summary}
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={inviting}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {inviting ? "Sending..." : "Send invite"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteEmail("");
                  setInviteName("");
                  setInviteRole("member");
                }}
                className="px-4 py-2 bg-zinc-200 text-zinc-700 rounded-lg hover:bg-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Pending invitations */}
      {canInvite && invitations.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-zinc-700 mb-2">Pending invitations</h3>
          <div className="space-y-1">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded text-sm"
              >
                <div>
                  <span className="font-medium text-zinc-900">{inv.email}</span>
                  <span className={roleBadgeClasses()}>{inv.roleDisplayName}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    expires {formatDate(inv.expiresAt)}
                  </span>
                </div>
                <button
                  onClick={() => handleRevokeInvite(inv.id)}
                  className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  title="Revoke this invitation"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members list */}
      {loading ? (
        <div className="text-sm text-zinc-500">Loading team members…</div>
      ) : activeMembers.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-4">
          No team members yet. Invite colleagues to share access.
        </div>
      ) : (
        <div className="space-y-2">
          {activeMembers.map((member) => {
            const isSelf = member.userId === currentUserId;
            const canEditThisRow = canManage && !member.isOwner && !isSelf;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-sm font-medium">
                    {(member.displayName || member.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      {member.displayName || member.email}
                      <span className={roleBadgeClasses()}>{member.roleDisplayName}</span>
                      {isSelf && (
                        <span className="ml-2 text-xs text-zinc-500">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {member.email}
                      {member.acceptedAt ? (
                        <span className="ml-2 text-emerald-600">Active</span>
                      ) : (
                        <span className="ml-2 text-amber-600">Pending</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canEditThisRow ? (
                    <select
                      value={
                        (PACKET_ROLES as readonly string[]).includes(member.role)
                          ? member.role
                          : ""
                      }
                      onChange={(e) =>
                        handleRoleChange(member, e.target.value as PacketRole)
                      }
                      className="text-xs px-2 py-1 border border-zinc-200 rounded bg-white"
                      title="Change role"
                    >
                      {ROLE_ORDER.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_PERMISSIONS[r].displayName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-zinc-400">
                      {formatDate(member.invitedAt)}
                    </span>
                  )}
                  {canEditThisRow && (
                    <button
                      onClick={() => handleRemove(member)}
                      className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 text-xs text-zinc-500">
        Owner row cannot be removed or demoted. Multiple Team Admins are allowed.
      </div>
    </div>
  );
}
