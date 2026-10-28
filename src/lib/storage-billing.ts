/**
 * Sub-cent accumulator for storage billing.
 *
 * Storage is metered every 30 min, but at typical rates (~$0.00004/GB/hr) the
 * raw cost per interval is well under 1¢. Math.round on each interval would
 * either drop the charge to $0 or inflate it to $0.01 — creating a $14.60/mo
 * minimum-charge cliff that doesn't match advertised pricing.
 *
 * This accumulator carries fractional cents forward and only emits a Stripe
 * balance transaction when the running balance crosses 1¢. Customers pay
 * exactly the advertised rate, with no rounding floor.
 */

export interface StorageAccumulatorState {
  pendingCents: number;
  pendingGbHours: number;
  windowStartedAt: number;
}

export interface StorageChargeResult {
  charge: {
    cents: number;
    description: string;
    avgGb: number;
    windowHours: number;
    windowStartedAt: number;
    windowEndedAt: number;
  } | null;
  newState: StorageAccumulatorState;
}

function formatUTC(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function computeStorageCharge(
  state: StorageAccumulatorState,
  totalStorageGb: number,
  ratePerGBHourCents: number,
  hoursInInterval: number,
  nowSec: number,
): StorageChargeResult {
  const intervalCostCents = totalStorageGb * ratePerGBHourCents * hoursInInterval;
  const intervalGbHours = totalStorageGb * hoursInInterval;

  const pendingCents = state.pendingCents + intervalCostCents;
  const pendingGbHours = state.pendingGbHours + intervalGbHours;

  if (pendingCents < 1) {
    return {
      charge: null,
      newState: {
        pendingCents,
        pendingGbHours,
        windowStartedAt: state.windowStartedAt,
      },
    };
  }

  const billedCents = Math.floor(pendingCents);
  const remainderCents = pendingCents - billedCents;

  const windowSeconds = Math.max(1, nowSec - state.windowStartedAt);
  const windowHours = windowSeconds / 3600;
  const avgGb = Math.round(pendingGbHours / windowHours);

  const rateDisplay = (ratePerGBHourCents / 100).toFixed(6);
  const startUTC = formatUTC(state.windowStartedAt);

  // GB-hours from the cents actually billed, so rate x GB-hrs equals the charge.
  // GB-hours still accrued below 1c stay pending and are billed in a later line.
  const billedGbHours = ratePerGBHourCents > 0 ? billedCents / ratePerGBHourCents : pendingGbHours;

  const description =
    `Storage: ${billedGbHours.toFixed(2)} GB-hrs @ $${rateDisplay}/GB/hr ` +
    `(accrued since ${startUTC} UTC)`;

  return {
    charge: {
      cents: billedCents,
      description,
      avgGb,
      windowHours,
      windowStartedAt: state.windowStartedAt,
      windowEndedAt: nowSec,
    },
    newState: {
      pendingCents: remainderCents,
      pendingGbHours: 0,
      windowStartedAt: nowSec,
    },
  };
}

/**
 * Real elapsed hours since the last storage metering, for accrual.
 *
 * Storage must accrue on WALL-CLOCK time, not a fixed nominal interval. The
 * accumulator's GB-hours (numerator of the "avg GB" label) and cost both scale
 * with this value, while the displayed window scales with real time. If the
 * caller passes a fixed 30 min but the sync actually fires every ~25-30 min,
 * the two diverge: "avg GB" inflates (e.g. a steady 100GB volume shows 111GB)
 * and storage over-bills. Feeding real elapsed keeps them consistent so the
 * label reflects the true volume and the charge matches actual elapsed time.
 * See PA-168.
 *
 * Falls back to the nominal interval on the first metering (no prior timestamp)
 * and caps the interval so a sync outage can't bill an unbounded chunk at once.
 */
export function storageIntervalHours(
  nowSec: number,
  lastSyncSec: number | null,
  nominalMinutes: number,
  capMinutes: number,
): number {
  if (lastSyncSec === null || !Number.isFinite(lastSyncSec) || lastSyncSec <= 0) {
    return nominalMinutes / 60;
  }
  // ponytail: cap at capMinutes; a sync outage longer than this under-bills the
  // excess rather than billing a giant chunk in one charge. Safe direction.
  const elapsedSec = Math.min(Math.max(0, nowSec - lastSyncSec), capMinutes * 60);
  return elapsedSec / 3600;
}
