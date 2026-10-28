/**
 * Generic ops alert — a process/system failure notification that is NOT tied to
 * any one feature. Deliberately separate from baremetal's notifyOps (which is
 * brand-stamped "[Brand BareMetal]" and lives in the billing seam we don't
 * touch in maintenance mode).
 *
 * Always logs to console first, THEN best-effort emails. The console line is the
 * load-bearing guarantee: if SMTP is the thing that's down, the alert still
 * lands in the logs rather than vanishing silently.
 */

import { sendEmail } from "@/lib/email/client";
import { getSetting } from "@/lib/settings";
import { getSupportEmail } from "@/lib/branding";

async function opsEmailAddress(): Promise<string> {
  // Reuse the baremetal ops inbox if set (same humans), else support email.
  return (
    (await getSetting("OPS_ALERT_EMAIL")) ||
    (await getSetting("BAREMETAL_OPS_EMAIL")) ||
    getSupportEmail()
  );
}

/**
 * Fire an ops alert. `console.error` always runs; email is best-effort and never
 * throws (a failed alert must not break the caller). `tag` prefixes the log +
 * subject so alerts are greppable per source (e.g. "Daily Ops Summary").
 */
export async function opsAlert(
  tag: string,
  subject: string,
  lines: string[] = [],
): Promise<void> {
  console.error(`[${tag}] OPS ALERT: ${subject}${lines.length ? "\n" + lines.join("\n") : ""}`);
  try {
    const to = await opsEmailAddress();
    await sendEmail({
      to,
      subject: `[${tag}] ${subject}`,
      text: [subject, "", ...lines].join("\n"),
      html: `<p><strong>${subject}</strong></p>${lines.map((l) => `<p>${l}</p>`).join("")}`,
    });
  } catch (err) {
    console.error(`[${tag}] ops alert email failed (non-fatal):`, err);
  }
}
