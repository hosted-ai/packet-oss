// The wallet card's $/hr, per-second ticker and "remaining" runway all derive
// from this. Stopped pods keep billing at the reservation percentage, so they
// belong in the burn — omitting them understated every one of those numbers.

export interface BurnRateSubscription {
  status?: string;
  nature?: string;
  hourlyRate?: number;
}

export interface HourlyBurn {
  /** $/hr from running/starting pods at their full rate. */
  runningHourly: number;
  /** $/hr from stopped pods at the reservation percentage. */
  stoppedHourly: number;
  /** Everything the wallet is actually draining per hour. */
  totalHourly: number;
  /** Count of stopped pods that still bill. */
  stoppedBillableCount: number;
}

const ACTIVE_STATUSES = new Set(["subscribed", "active", "running", "pending", "starting", "restarting"]);
const STOPPED_STATUSES = new Set(["stopped", "exited"]);

export function computeHourlyBurn(
  subscriptions: BurnRateSubscription[],
  stoppedRatePercent: number,
): HourlyBurn {
  let runningHourly = 0;
  let stoppedHourly = 0;
  let stoppedBillableCount = 0;
  for (const sub of subscriptions) {
    if (sub.nature === "baremetal") continue; // term-prepaid, never wallet-billed hourly
    const status = sub.status || "";
    if (ACTIVE_STATUSES.has(status)) {
      runningHourly += sub.hourlyRate || 0;
    } else if (STOPPED_STATUSES.has(status)) {
      const reserve = (sub.hourlyRate || 0) * (stoppedRatePercent / 100);
      if (reserve > 0) {
        stoppedHourly += reserve;
        stoppedBillableCount++;
      }
    }
  }
  return {
    runningHourly,
    stoppedHourly,
    totalHourly: runningHourly + stoppedHourly,
    stoppedBillableCount,
  };
}
