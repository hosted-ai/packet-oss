"use client";

// Account-switcher dropdown for the dashboard sidebar.
//
// Lists every account the current user is an active member of (own primary
// + every invitation they've accepted + every Stripe customer where their
// email matches as implicit-Owner). Clicking another team calls
// /api/session/switch-account to mint a new JWT with activeAccountId set,
// then reloads /dashboard?token=<newJWT> — staying consistent with the
// "JWT-in-URL is the source of truth" auth pattern.

import { useEffect, useMemo, useRef, useState } from "react";

interface AccountListItem {
  accountId: string;
  teamName: string | null;
  ownerEmail: string | null;
  role: string;
  roleDisplayName: string;
  isOwner: boolean;
  isActive: boolean;
}

interface Props {
  token: string;
}

function labelFor(account: AccountListItem): string {
  // Own account: highlight as "My account" so users immediately spot it.
  // Team name (if set) is rendered as a parenthetical hint.
  if (account.isOwner) {
    return account.teamName
      ? `My account (${account.teamName})`
      : "My account";
  }
  // Invited account: prefer team name, fall back to the owner's email so
  // there's always a recognizable label.
  return account.teamName || account.ownerEmail || account.accountId;
}

export function AccountSwitcher({ token }: Props) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountListItem[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session/accounts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { accounts: AccountListItem[] };
        if (!cancelled) setAccounts(data.accounts);
      } catch {
        // Silent — switcher just won't render extra entries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = useMemo(
    () => accounts?.find((a) => a.isActive) ?? null,
    [accounts],
  );

  async function switchTo(accountId: string) {
    if (accountId === active?.accountId) {
      setOpen(false);
      return;
    }
    setSwitching(accountId);
    setError(null);
    try {
      const res = await fetch("/api/session/switch-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ accountId }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Failed to switch account.");
        setSwitching(null);
        return;
      }
      // Reload the dashboard with the new token. Match how every other auth
      // landing in the app works: JWT lives in the URL query string.
      // eslint-disable-next-line react-hooks/immutability -- intentional full-page navigation, not a React state mutation
      window.location.href = `/dashboard?token=${data.token}`;
    } catch {
      setError("Network error.");
      setSwitching(null);
    }
  }

  // If we couldn't fetch (or there's only one account), don't render the
  // switcher chip — keeps the sidebar clean for single-team users.
  if (!accounts || accounts.length <= 1) return null;

  return (
    <div ref={containerRef} className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900/5 hover:bg-zinc-900/10 rounded-lg text-left text-sm"
      >
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
            {active?.isOwner ? "Workspace" : "Team"}
          </div>
          <div className="font-medium text-zinc-900 truncate">
            {active ? labelFor(active) : "Select a team"}
          </div>
          {active && (
            <div className="text-[11px] text-zinc-500">
              {active.isOwner && !active.teamName
                ? "Owner"
                : active.roleDisplayName}
            </div>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-30 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {accounts.map((a) => {
            const busy = switching === a.accountId;
            return (
              <button
                key={a.accountId}
                type="button"
                onClick={() => switchTo(a.accountId)}
                disabled={busy}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 ${a.isActive ? "bg-purple-50" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-zinc-900 truncate">
                    {labelFor(a)}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {a.isOwner ? (
                      // Own account: "Owner · john@x.com" so user can disambiguate
                      // multiple "My account" entries by the underlying identity.
                      <>
                        Owner
                        {a.ownerEmail ? ` · ${a.ownerEmail}` : ""}
                      </>
                    ) : (
                      <>
                        {a.roleDisplayName}
                        {a.ownerEmail ? ` · invited by ${a.ownerEmail}` : ""}
                      </>
                    )}
                    {a.isActive ? " · current" : ""}
                  </div>
                </div>
                {busy && (
                  <span className="text-[11px] text-zinc-500">Switching…</span>
                )}
              </button>
            );
          })}
          {error && (
            <div className="px-3 py-2 text-xs text-red-700 border-t border-zinc-200">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
