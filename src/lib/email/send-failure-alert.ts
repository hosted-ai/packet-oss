/**
 * Outbound-send failure threshold.
 *
 * Every send routes through client.ts's `sendRaw`, which reports each outcome
 * here. A run of consecutive failures — or a single quota/limit or credential
 * refusal, which stops every sender rather than one recipient — fires one ops
 * alert, throttled per kind so one class of refusal cannot mask another.
 *
 * The escape channel is `opsAlert`'s `console.error` line, which always runs
 * and lands in the pm2 log the box's monitoring reads. Its email attempt is
 * best-effort by design: an email alert about email being down never arrives.
 */

import { opsAlert } from "@/lib/ops-alert";

const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const ALERT_THROTTLE_MS = 30 * 60 * 1000;

type AlertKind = "auth" | "quota" | "run";

interface FailureState {
  consecutive: number;
  lastAlertAt: Partial<Record<AlertKind, number>>;
  alerting: boolean;
}

const globalForFailures = globalThis as unknown as {
  __emailFailureState?: FailureState;
};

// Held on globalThis so it survives Next.js hot-reloads, as the SMTP pool is.
function failureState(): FailureState {
  return (globalForFailures.__emailFailureState ??= {
    consecutive: 0,
    lastAlertAt: {},
    alerting: false,
  });
}

// A provider quota/limit refusal, as distinct from one undeliverable address:
// the SMTP credential is shared estate-wide, so it refuses every sender.
export function isQuotaRefusal(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /quota|throttl|too many (messages|emails|recipients)|(rate|sending|daily|hourly|message) limit|limit (exceeded|reached)/.test(msg);
}

const AUTH_RESPONSE_CODES = new Set([530, 534, 535, 538]);
const AUTH_MESSAGE =
  /\b53[0458]\b[ -]?\d\.\d\.\d|authentication (failed|failure|required|unsuccessful)|invalid login|username and password not accepted|bad credentials/;

// A credential refusal: the key is revoked, rotated or suspended, so no sender
// gets through until an operator restores it — recoverable, but only by hand.
export function isAuthRefusal(err: unknown): boolean {
  const e = err as { responseCode?: number; code?: string } | null;
  if (e?.code === "EAUTH") return true;
  if (e?.responseCode !== undefined && AUTH_RESPONSE_CODES.has(e.responseCode)) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return AUTH_MESSAGE.test(msg);
}

// Clear the failure run — the transport is delivering again.
export function noteSendSuccess(): void {
  failureState().consecutive = 0;
}

// Which alert this failure earns, or null for one that is not yet an incident.
function classify(err: unknown, consecutive: number): AlertKind | null {
  if (isAuthRefusal(err)) return "auth";
  if (isQuotaRefusal(err)) return "quota";
  return consecutive >= CONSECUTIVE_FAILURE_THRESHOLD ? "run" : null;
}

function alertText(kind: AlertKind, consecutive: number): { subject: string; detail: string } {
  if (kind === "auth") {
    return {
      subject: "SMTP credential refused — authentication failed",
      detail:
        "The SMTP key is revoked, rotated or suspended. Mail is queued for re-send and stays queued until an operator restores the credential.",
    };
  }
  if (kind === "quota") {
    return {
      subject: "SMTP provider refused a send on quota/limit",
      detail: "The SMTP credential is shared across the estate, so other senders are refused too.",
    };
  }
  return {
    subject: `${consecutive} consecutive outbound email failures`,
    detail: "Outbound mail is failing for every recipient — sign-in links are not being delivered.",
  };
}

// Record a failed send and alert if it breaches a threshold. Never throws, so
// the caller can fire it without awaiting.
export async function noteSendFailure(to: string, err: unknown): Promise<void> {
  const state = failureState();
  // The alert's own send failing must not re-enter and recurse.
  if (state.alerting) return;

  state.consecutive += 1;
  const kind = classify(err, state.consecutive);
  if (!kind) return;

  const now = Date.now();
  // Per kind: a quota refusal clears itself, a credential one needs a human, so
  // neither may throttle the other into silence.
  if (now - (state.lastAlertAt[kind] ?? 0) < ALERT_THROTTLE_MS) return;
  state.lastAlertAt[kind] = now;

  const { subject, detail } = alertText(kind, state.consecutive);

  state.alerting = true;
  try {
    await opsAlert("Email Delivery", subject, [
      detail,
      `Last recipient: ${to}`,
      `SMTP error: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  } catch (alertErr) {
    console.error("[Email Delivery] failure alert did not fire:", alertErr);
  } finally {
    state.alerting = false;
  }
}
