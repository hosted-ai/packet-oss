/**
 * Region maintenance resolver — the single source of truth for "is this HAI
 * region in maintenance?". One small indexed table (region_maintenance), one
 * cached read, consumed by four call sites:
 *   1. GPU provision gate      (api/instances handleUnifiedInstanceCreate)
 *   2. baremetal provision gate (lib/baremetal/provision startProvisioning)
 *   3. baremetal order-create   (api/dashboard/bare-metal/orders POST)
 *   4. card stamping            (api/instances GET — maintenance:{active,message})
 *
 *   getMaintenanceMap() ──cached ~30s──▶ Map<regionId, {message, regionName}>
 *        │ DB error
 *        ▼
 *   FAIL-OPEN: log + throttled ops alert, serve stale-or-empty → callers proceed.
 *   (user decision: a DB blip / half-applied migration must never brick
 *   provisioning or trap a dashboard user. The residual risk — a provision
 *   slipping into a down region during a DB outage — is alerted, not silent.)
 *
 * Granularity is REGION, not pool: the GPU pool is HAI-chosen after the region
 * gate and baremetal subscribes region-wide, so a pool id has no consumer.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/client";
import { getSetting } from "@/lib/settings";
import { getBrandName, getSupportEmail } from "@/lib/branding";

/** Shown to customers when a region's admin message is blank. Calm, no CTA, silent on billing. */
export const DEFAULT_MAINTENANCE_MESSAGE =
  "This region is under maintenance. Controls are paused — your server and data are safe.";

/**
 * Thrown by createInstance() when its region is in maintenance — the
 * defense-in-depth gate that covers every GPU create path (snapshot/HF/v1) that
 * doesn't pre-check. Callers already refund on a createInstance throw.
 */
export class RegionMaintenanceError extends Error {
  readonly code = "REGION_IN_MAINTENANCE" as const;
  constructor(message: string) {
    super(message || DEFAULT_MAINTENANCE_MESSAGE);
    this.name = "RegionMaintenanceError";
  }
}

const CACHE_TTL_MS = 30_000; // short on purpose: ops toggle regions live during a window
const ALERT_THROTTLE_MS = 10 * 60_000; // don't storm ops if the DB flaps

interface Entry {
  message: string | null;
  regionName: string | null;
}

// Stored on globalThis so the cache + alert clock survive dev hot-reloads.
const g = globalThis as unknown as {
  __regionMaintCache?: { map: Map<number, Entry>; expiresAt: number };
  __regionMaintAlertAt?: number;
  __regionMaintInflight?: Promise<Map<number, Entry>> | null;
};

async function fetchActive(): Promise<Map<number, Entry>> {
  const rows = await prisma.regionMaintenance.findMany({
    select: { regionId: true, message: true, regionName: true },
  });
  return new Map(rows.map((r) => [r.regionId, { message: r.message, regionName: r.regionName }]));
}

/**
 * The active maintenance set as a Map (cached ~30s). Load ONCE per request and
 * check in memory — never call this per-instance in a loop.
 */
export async function getMaintenanceMap(): Promise<Map<number, Entry>> {
  const cached = g.__regionMaintCache;
  if (cached && cached.expiresAt > Date.now()) return cached.map;
  try {
    // Dedupe concurrent refreshes (a dashboard poll + a provision at once).
    if (!g.__regionMaintInflight) {
      g.__regionMaintInflight = fetchActive().finally(() => {
        g.__regionMaintInflight = null;
      });
    }
    const map = await g.__regionMaintInflight;
    g.__regionMaintCache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
    return map;
  } catch (err) {
    // FAIL-OPEN. Serve a stale set if we have one (better than empty), else empty.
    console.error(
      "[RegionMaintenance] resolver DB error — FAILING OPEN (regions treated as available until this clears):",
      err,
    );
    void alertOpsThrottled(err);
    return cached?.map ?? new Map();
  }
}

/** Region-level maintenance check. Returns the customer-facing message (defaulted). */
export async function isRegionInMaintenance(
  regionId: number | null | undefined,
): Promise<{ inMaintenance: boolean; message: string }> {
  if (!regionId) return { inMaintenance: false, message: "" };
  const map = await getMaintenanceMap();
  const entry = map.get(regionId);
  if (!entry) return { inMaintenance: false, message: "" };
  return { inMaintenance: true, message: entry.message?.trim() || DEFAULT_MAINTENANCE_MESSAGE };
}

/** Invalidate the cache immediately. Call after every admin write so the
 *  process that served the write reflects it at once (other PM2 workers
 *  converge within the TTL). */
export function bustMaintenanceCache(): void {
  g.__regionMaintCache = undefined;
}

// Best-effort, THROTTLED ops alert for the fail-open path. Self-contained (no
// import from baremetal/* — that would be circular, since the BM gate imports
// this resolver). The loud console.error above is the durable signal; this is
// the escalation, capped so a DB flap can't email-storm ops.
async function alertOpsThrottled(err: unknown): Promise<void> {
  const last = g.__regionMaintAlertAt ?? 0;
  if (Date.now() - last < ALERT_THROTTLE_MS) return;
  g.__regionMaintAlertAt = Date.now();
  try {
    const to = (await getSetting("BAREMETAL_OPS_EMAIL")) || getSupportEmail();
    const detail = err instanceof Error ? err.message : String(err);
    await sendEmail({
      to,
      subject: `[${getBrandName()} Ops] Region-maintenance check is failing open`,
      text:
        "The region-maintenance resolver hit a DB error and is FAILING OPEN: provisions are " +
        "NOT being gated by region maintenance until this clears. Investigate the DB / the " +
        `region_maintenance table.\n\n${detail}`,
      html:
        `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">` +
        `<p>The region-maintenance resolver hit a DB error and is <strong>failing open</strong>: ` +
        `provisions are <strong>not</strong> being gated by region maintenance until this clears.</p>` +
        `<p>Investigate the DB / the <code>region_maintenance</code> table.</p>` +
        `<pre style="background:#f6f6f6;padding:8px;border-radius:4px">${detail}</pre></div>`,
    });
  } catch (e) {
    console.error("[RegionMaintenance] ops alert failed (non-fatal):", e);
  }
}
