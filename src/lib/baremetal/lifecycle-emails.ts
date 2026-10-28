/**
 * Customer-facing emails for the bare-metal order lifecycle.
 *
 * All use the shared house layout (emailLayout + branded header/footer + CTA
 * buttons + status panels) so they match the rest of the product's transactional
 * email and render well across clients (Outlook-safe, no <style> blocks).
 *
 * Emails:
 *   - order received (sent on placement; how to pay)
 *   - termination reminder (daily in the final week; escalating tone)
 *   - cancellation confirmation (ops cancelled the order)
 *   - refund confirmation (ops marked the refund issued)
 *   - terminated (node released at term end)
 *
 * Multi-server orders provision order.serverCount nodes — copy pluralises to
 * match. All are best-effort: a send failure is logged, never thrown (an email
 * hiccup must not roll back a state transition or halt a cron batch).
 */

import type { BareMetalOrder } from "@prisma/client";
import { sendEmail } from "@/lib/email/client";
import { getBrandName, getDashboardUrl, getSupportEmail, getAppUrl } from "@/lib/branding";
import {
  escapeHtml,
  emailLayout,
  emailButton,
  emailButtonTeal,
  emailText,
  emailMuted,
  emailInfoBox,
  emailSuccessBox,
  emailWarningBox,
  emailDangerBox,
  emailDetailBox,
  emailSignoff,
  plainTextFooter,
} from "@/lib/email/utils";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const dateStr = (d: Date): string =>
  d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

async function safeSend(
  order: Pick<BareMetalOrder, "id" | "email">,
  label: string,
  params: { subject: string; html: string; text: string },
): Promise<void> {
  try {
    await sendEmail({ to: order.email, ...params });
  } catch (err) {
    console.error(`[BareMetal] ${label} email failed for ${order.id} (non-fatal):`, err);
  }
}

// Multi-server orders provision order.serverCount independent nodes — render the
// spec and prose to match the count.
type SpecLike = Pick<BareMetalOrder, "gpuType" | "serverCount">;
const isMulti = (o: Pick<BareMetalOrder, "serverCount">): boolean => (o.serverCount ?? 1) > 1;
// "B200" (1) or "4× B200" (N) — spec label used in copy + detail rows.
const specLabel = (o: SpecLike): string => (isMulti(o) ? `${o.serverCount}× ${o.gpuType}` : o.gpuType);

// Two-column key/value panel for order details (escaped, Outlook-safe table).
function detailBox(rows: Array<[string, string]>): string {
  const trs = rows
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding: 6px 0; font-size: 13px; color: #5b6476; vertical-align: top;">${escapeHtml(k)}</td>
          <td style="padding: 6px 0; font-size: 13px; color: #0b0f1c; font-weight: 600; text-align: right;">${escapeHtml(v)}</td>
        </tr>`,
    )
    .join("");
  return emailDetailBox(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs}</table>`,
  );
}

const invoiceUrlFor = (order: BareMetalOrder): string =>
  order.hostedInvoiceUrl || `${getAppUrl()}/invoice/${order.id}`;

/**
 * Order received — sent on placement so the customer knows the order landed and
 * how to pay. Mode-aware: wire transfer (manual_bank) vs the Stripe invoice
 * link. Provisioning only begins after payment is confirmed.
 */
export async function sendOrderReceivedEmail(order: BareMetalOrder): Promise<void> {
  const brand = getBrandName();
  const isManual = order.paymentMode === "manual_bank";
  const total = usd(order.totalInvoiceCents);
  const invoiceUrl = invoiceUrlFor(order);

  const payCopy = isManual
    ? `To start provisioning, complete payment by <strong>wire transfer</strong>. The bank details and your wire reference (<strong>${escapeHtml(order.invoiceNumber)}</strong>) are on your invoice.`
    : `To start provisioning, <strong>complete payment</strong> via your invoice.`;

  const body = `
    ${emailText(`Thanks for your order — we've received it and it's ready for payment.`)}
    ${detailBox([
      ["Order", order.invoiceNumber],
      ["Configuration", specLabel(order)],
      ["Term", `${order.contractMonths} month${order.contractMonths === 1 ? "" : "s"}`],
      ["Total due", total],
    ])}
    ${emailText(payCopy)}
    ${emailButton(isManual ? "View invoice & payment details" : "View & pay invoice", invoiceUrl)}
    ${emailMuted(`We'll begin provisioning as soon as your payment is confirmed. Questions? <a href="mailto:${getSupportEmail()}" style="color:#5b6476;">Contact us</a>.`)}
    ${emailSignoff()}
  `;

  await safeSend(order, "order-received", {
    subject: `[${brand}] Order ${order.invoiceNumber} received — complete payment to provision`,
    html: emailLayout({ preheader: `Order received — complete payment to provision`, body }),
    text:
      `We've received your order ${order.invoiceNumber} (${specLabel(order)}, ${order.contractMonths}-month term).\n` +
      `Total due: ${total}.\n\n` +
      (isManual
        ? `Complete payment by wire transfer; bank details + your reference (${order.invoiceNumber}) are on your invoice:\n${invoiceUrl}\n`
        : `Complete payment via your invoice:\n${invoiceUrl}\n`) +
      `\nProvisioning begins once payment is confirmed. Questions? ${getSupportEmail()}\n\n` +
      `The ${brand} Team\n${plainTextFooter()}`,
  });
}

/**
 * Termination reminder. daysLeft escalates the tone (7 = heads-up, 1 = FINAL).
 * Never includes SSH/credentials (security) — points the customer at the dash.
 */
export async function sendTerminationReminderEmail(
  order: BareMetalOrder,
  daysLeft: number,
): Promise<void> {
  const brand = getBrandName();
  const when = order.expiresAt ? dateStr(order.expiresAt) : "soon";
  const urgent = daysLeft <= 1;
  const many = isMulti(order);
  const dash = getDashboardUrl();

  const headline = urgent
    ? `FINAL NOTICE: your ${specLabel(order)} ${many ? "servers are" : "server is"} terminated tomorrow`
    : `Your ${specLabel(order)} ${many ? "servers terminate" : "server terminates"} in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

  const warning = `<p style="margin:0;font-size:14px;line-height:1.5;color:#0b0f1c;"><strong>Back up your data now.</strong> At termination the ${many ? "servers are" : "server is"} released and <strong>all data ${many ? "on them" : "on it"} is permanently lost</strong>. There is no recovery after that point.</p>`;

  const body = `
    ${emailText(`<strong style="font-size:17px;">${escapeHtml(headline)}</strong>`)}
    ${urgent ? emailDangerBox(warning) : emailWarningBox(warning)}
    ${detailBox([
      ["Order", order.invoiceNumber],
      ["Configuration", specLabel(order)],
      ["Contract ends", when],
    ])}
    ${emailText(`To keep ${many ? "them" : "it"} running, <a href="mailto:${getSupportEmail()}" style="color:#1a4fff;">contact us to extend</a> before then.`)}
    ${emailButton("Manage your order", dash)}
    ${emailSignoff()}
  `;

  await safeSend(order, "termination-reminder", {
    subject: `[${brand}] ${headline}`,
    html: emailLayout({ preheader: headline, body }),
    text:
      `${headline}\n\nOrder ${order.invoiceNumber} (${specLabel(order)}) ends on ${when}.\n\n` +
      `BACK UP YOUR DATA NOW — at termination the ${many ? "servers are" : "server is"} released and all data is permanently lost.\n\n` +
      `To extend, contact ${getSupportEmail()}. Manage your order: ${dash}\n\n` +
      `The ${brand} Team\n${plainTextFooter()}`,
  });
}

/** Cancellation confirmation. Calm; states whether a refund is coming. */
export async function sendCancellationEmail(order: BareMetalOrder): Promise<void> {
  const brand = getBrandName();
  const hasRefund = !!order.refundAmountCents && order.refundAmountCents > 0;
  const refundBox = hasRefund
    ? emailInfoBox(
        `<p style="margin:0;font-size:14px;color:#0b0f1c;">A refund of <strong>${usd(order.refundAmountCents!)}</strong> is being processed and will follow separately.</p>`,
      )
    : emailMuted("No refund is due on this order.");

  const body = `
    ${emailText(`Your bare metal order has been cancelled.`)}
    ${detailBox([
      ["Order", order.invoiceNumber],
      ["Configuration", specLabel(order)],
    ])}
    ${refundBox}
    ${emailText(`Questions? <a href="mailto:${getSupportEmail()}" style="color:#1a4fff;">Contact us</a> — we're happy to help.`)}
    ${emailSignoff()}
  `;

  await safeSend(order, "cancellation", {
    subject: `[${brand}] Your bare metal order ${order.invoiceNumber} was cancelled`,
    html: emailLayout({ preheader: `Order ${order.invoiceNumber} cancelled`, body }),
    text:
      `Your order was cancelled.\n\nOrder ${order.invoiceNumber} (${specLabel(order)}) has been cancelled.\n` +
      (hasRefund
        ? `A refund of ${usd(order.refundAmountCents!)} is being processed and will follow separately.\n`
        : `No refund is due on this order.\n`) +
      `\nQuestions? ${getSupportEmail()}\n\nThe ${brand} Team\n${plainTextFooter()}`,
  });
}

/** Refund confirmation — amount + reference + expected timing. */
export async function sendRefundEmail(order: BareMetalOrder): Promise<void> {
  const brand = getBrandName();
  const amount = order.refundAmountCents ? usd(order.refundAmountCents) : "your refund";
  const ref = order.refundReference
    ? ` (reference <strong>${escapeHtml(order.refundReference)}</strong>)`
    : "";

  const body = `
    ${emailSuccessBox(
      `<p style="margin:0;font-size:15px;color:#0b0f1c;"><strong>Refund issued: ${amount}</strong>${ref}</p>`,
    )}
    ${emailText(`We've issued a refund for order <strong>${escapeHtml(order.invoiceNumber)}</strong>.`)}
    ${emailText(`Funds typically arrive within <strong>3–5 business days</strong>, depending on your bank.`)}
    ${emailMuted(`Questions? <a href="mailto:${getSupportEmail()}" style="color:#5b6476;">Contact us</a>.`)}
    ${emailSignoff()}
  `;

  await safeSend(order, "refund", {
    subject: `[${brand}] Refund issued for order ${order.invoiceNumber}`,
    html: emailLayout({ preheader: `Refund issued — ${amount}`, body }),
    text:
      `Your refund has been issued.\n\nWe've issued a refund of ${amount}${
        order.refundReference ? ` (reference ${order.refundReference})` : ""
      } for order ${order.invoiceNumber}.\n` +
      `Funds typically arrive within 3-5 business days.\n\nQuestions? ${getSupportEmail()}\n\n` +
      `The ${brand} Team\n${plainTextFooter()}`,
  });
}

/** Terminated — node(s) released at the end of the term. */
export async function sendTerminatedEmail(order: BareMetalOrder): Promise<void> {
  const brand = getBrandName();
  const many = isMulti(order);
  const dash = getDashboardUrl();

  const body = `
    ${emailText(`Your ${escapeHtml(specLabel(order))} ${many ? "servers have" : "server has"} been terminated. The contract term for order <strong>${escapeHtml(order.invoiceNumber)}</strong> has ended and the ${many ? "servers have" : "server has"} been released.`)}
    ${emailButtonTeal("Start a new order", dash)}
    ${emailMuted(`Need another? Start a new order from your dashboard, or <a href="mailto:${getSupportEmail()}" style="color:#5b6476;">contact us</a>.`)}
    ${emailSignoff()}
  `;

  await safeSend(order, "terminated", {
    subject: `[${brand}] Your bare metal order ${order.invoiceNumber} has been terminated`,
    html: emailLayout({ preheader: `Order ${order.invoiceNumber} terminated`, body }),
    text:
      `Your ${many ? "servers have" : "server has"} been terminated.\n\nThe term for order ${order.invoiceNumber} (${specLabel(order)}) ` +
      `has ended and the ${many ? "servers have" : "server has"} been released.\n\nNeed another? ${dash} or ${getSupportEmail()}\n\n` +
      `The ${brand} Team\n${plainTextFooter()}`,
  });
}
