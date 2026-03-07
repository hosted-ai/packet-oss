"use client";

import { useState, useEffect, useCallback } from "react";

interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  invitedAt: string;
  acceptedAt: string | null;
  invitedBy: string | null;
}

interface TeamMembersProps {
  token: string;
  isOwner?: boolean;
}

export default function TeamMembers({ token, isOwner = true }: TeamMembersProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const response = await fetch("/api/account/team-members", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setMembers(data.members || []);
      }
    } catch (err) {
      console.error("Failed to fetch team members:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setInviting(true);

    try {
      const response = await fetch("/api/account/team-members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to invite team member");
      }

      setSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteName("");
      setShowInviteForm(false);
      fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite team member");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: string, memberEmail: string) => {
    if (!confirm(`Remove ${memberEmail} from the team?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/account/team-members?id=${memberId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove team member");
      }

      setSuccess(`${memberEmail} removed from team`);
      fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove team member");
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Only show for owners
  if (!isOwner) {
    return null;
  }

  return (
    <div className="border border-zinc-200 rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-900">Team Members</h2>
        {!showInviteForm && (
          <button
            onClick={() => setShowInviteForm(true)}
            className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            + Invite
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
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

      {/* Invite Form */}
      {showInviteForm && (
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
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Name (optional)
              </label>
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={inviting}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {inviting ? "Sending..." : "Send Invite"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteEmail("");
                  setInviteName("");
                }}
                className="px-4 py-2 bg-zinc-200 text-zinc-700 rounded-lg hover:bg-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Members List */}
      {loading ? (
        <div className="text-sm text-zinc-500">Loading team members...</div>
      ) : members.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-4">
          No team members yet. Invite colleagues to share access to your dashboard.
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-sm font-medium">
                  {(member.name || member.email)[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    {member.name || member.email}
                    {member.role === "owner" && (
                      <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                        Owner
                      </span>
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
                <span className="text-xs text-zinc-400">
                  {formatDate(member.invitedAt)}
                </span>
                {member.role !== "owner" && (
                  <button
                    onClick={() => handleRemove(member.id, member.email)}
                    className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-xs text-zinc-500">
        Team members can view and manage GPUs but cannot access billing or invite others.
      </div>
    </div>
  );
}
