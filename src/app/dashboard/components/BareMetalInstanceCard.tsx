"use client";

/**
 * Read-only pods-grid card for a HAI unified instance with nature="baremetal"
 * (a term-prepay bare metal server). Deliberately NOT PoolSubscriptionCard:
 * every VM action (start/stop/restart/terminate/SSH-via-connection-info)
 * either 400s on baremetal ids or doesn't apply to a prepaid term. The server
 * is managed from the Bare Metal tab — this card just surfaces presence,
 * live node state and the link there.
 *
 * Unified baremetal status vocabulary (HAI surfaces the NODE status while the
 * subscription is Active): requested | online | offline | rebooting | deleting.
 * Terminated/Failed rows disappear from the unified list entirely.
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { PoolSubscription } from "./types";
import { BareMetalSshAccess } from "./BareMetalSshAccess";

const BM_STATUS: Record<string, { label: string; dot: string; pulse?: boolean }> = {
  requested: { label: "Awaiting node assignment", dot: "bg-amber-400", pulse: true },
  online: { label: "Online", dot: "bg-emerald-500" },
  offline: { label: "Offline", dot: "bg-rose-500" },
  rebooting: { label: "Rebooting", dot: "bg-amber-400", pulse: true },
  deleting: { label: "Deleting", dot: "bg-orange-500", pulse: true },
};

interface Props {
  subscription: PoolSubscription;
  /** Auth token — enables the SSH access section (credentials fetch) */
  token?: string;
  /** Opens the Bare Metal orders tab; omit to hide the Manage link (RBAC/OSS) */
  onManage?: () => void;
}

export function BareMetalInstanceCard({ subscription, token, onManage }: Props) {
  const [showSsh, setShowSsh] = useState(false);
  const status = BM_STATUS[subscription.status] ?? {
    label: subscription.status || "Unknown",
    dot: "bg-zinc-300",
  };
  const bm = subscription.baremetal;
  const ip = subscription.ip?.[0];
  const specLine = bm?.gpuType
    ? `${bm.gpuCount && bm.gpuCount > 1 ? `${bm.gpuCount}x ` : ""}${bm.gpuType}`
    : null;

  return (
    <div className="bg-white rounded-2xl border border-[var(--line)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${status.dot} ${status.pulse ? "animate-pulse" : ""}`}
            />
            <h3 className="font-medium text-[var(--ink)] truncate">
              {specLine ?? subscription.pool_name ?? `Server ${subscription.id}`}
            </h3>
            <span className="px-1.5 py-0.5 bg-zinc-900 text-white rounded text-[10px] font-medium uppercase tracking-wide shrink-0">
              Bare Metal
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {status.label}
            {subscription.region?.region_name && (
              <>
                {" "}
                &middot; {subscription.region.region_name}
                {subscription.region.city ? ` (${subscription.region.city})` : ""}
              </>
            )}
          </p>
          {specLine && subscription.pool_name && (
            <p className="text-xs text-zinc-400 font-mono mt-1">{subscription.pool_name}</p>
          )}
          {ip && <p className="text-xs text-zinc-400 font-mono mt-0.5">{ip}</p>}
        </div>
        <div className="text-right shrink-0">
          {bm?.contractMonths ? (
            <div className="text-sm font-semibold text-[var(--ink)] whitespace-nowrap">
              {bm.contractMonths} mo term
            </div>
          ) : null}
          <div className="text-xs text-zinc-400">Prepaid</div>
          {onManage && (
            <button
              onClick={onManage}
              className="mt-2 text-sm text-[var(--blue)] hover:underline whitespace-nowrap"
            >
              Manage &rarr;
            </button>
          )}
        </div>
      </div>

      {subscription.maintenance?.active && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-amber-800">{subscription.maintenance.message}</p>
        </div>
      )}

      {/* SSH access — only once the order is provisioned; the password is
          fetched on demand (Packet never stores it) */}
      {token &&
        bm?.orderId &&
        subscription.status === "online" &&
        bm.orderStatus === "active" && (
          <div className="mt-4">
            {showSsh ? (
              <BareMetalSshAccess
                orderId={bm.orderId}
                token={token}
                subscriptionId={String(subscription.id)}
                ip={ip}
              />
            ) : (
              <button
                onClick={() => setShowSsh(true)}
                className="text-sm text-[var(--blue)] hover:underline"
              >
                Show SSH access
              </button>
            )}
          </div>
        )}
    </div>
  );
}
