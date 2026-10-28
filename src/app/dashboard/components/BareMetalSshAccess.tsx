"use client";

/**
 * SSH access block for a provisioned bare-metal order — shared by the
 * dashboard pods-grid card and the Bare Metal Orders tab so the two never
 * drift. The password is NOT in the order payload (Packet never stores it);
 * it is fetched on demand from /api/dashboard/bare-metal/orders/{id}/credentials
 * (which proxies HAI's credentials endpoint) and only when the customer
 * clicks "Reveal password".
 */

import { useState } from "react";

interface Credentials {
  ip?: string | null;
  username?: string | null;
  password?: string | null;
  port?: number | null;
}

interface Props {
  orderId: string;
  token: string;
  /** Which server's credentials to fetch — a multi-server order has one HAI
   * subscription per server. Omitted → the order's primary subscription. */
  subscriptionId?: string | null;
  /** Known-from-order fallbacks shown before/without the credentials fetch */
  sshCommand?: string | null;
  ip?: string | null;
  port?: number | null;
  hostname?: string | null;
}

export function BareMetalSshAccess({ orderId, token, subscriptionId, sshCommand, ip, port, hostname }: Props) {
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const command =
    sshCommand ||
    (creds?.ip
      ? `ssh ${creds.username || "root"}@${creds.ip}${creds.port && creds.port !== 22 ? ` -p ${creds.port}` : ""}`
      : null);

  const copy = (what: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied((prev) => (prev === what ? null : prev)), 1500);
  };

  const revealPassword = async () => {
    if (creds?.password) {
      setShowPassword((v) => !v);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = subscriptionId ? `?subscriptionId=${encodeURIComponent(subscriptionId)}` : "";
      const res = await fetch(`/api/dashboard/bare-metal/orders/${orderId}/credentials${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCreds(data);
      setShowPassword(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="p-4 bg-zinc-900 text-green-400 rounded-xl font-mono text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-zinc-500 mb-2">SSH ACCESS</div>
      {command && (
        <div className="flex items-center justify-between gap-2">
          <span className="break-all">{command}</span>
          <button
            onClick={() => copy("cmd", command)}
            className="text-xs bg-zinc-800 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 shrink-0"
          >
            {copied === "cmd" ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {/* Password — fetched on demand, never stored by Packet */}
      <div className="flex items-center justify-between gap-2 mt-2">
        {creds?.password && showPassword ? (
          <span className="break-all text-amber-300">{creds.password}</span>
        ) : (
          <span className="text-zinc-500 text-xs">
            {creds?.password ? "Password hidden" : "Password available on request"}
          </span>
        )}
        <div className="flex gap-1 shrink-0">
          {creds?.password && (
            <button
              onClick={() => copy("pwd", creds.password!)}
              className="text-xs bg-zinc-800 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300"
            >
              {copied === "pwd" ? "Copied" : "Copy"}
            </button>
          )}
          <button
            onClick={revealPassword}
            disabled={loading}
            className="text-xs bg-zinc-800 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
          >
            {loading ? "Fetching..." : creds?.password && showPassword ? "Hide" : "Reveal password"}
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-400 mt-2">{error}</div>}

      <div className="text-xs text-zinc-500 mt-2">
        {hostname ? `Host: ${hostname} · ` : ""}
        IP: {creds?.ip || ip || "—"}
        {(creds?.port || port) ? ` · Port: ${creds?.port || port}` : ""}
      </div>
    </div>
  );
}
