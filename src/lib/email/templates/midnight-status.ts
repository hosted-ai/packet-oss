/**
 * Midnight Status Report Email
 *
 * Sends a daily KPI snapshot to partners@hosted.ai at midnight.
 * Compares today's metrics against the same day last week,
 * and includes 7-day trend history for all key metrics.
 */

import { sendEmailDirect } from "../client";
import {
  emailLayout,
  emailText,
  emailDivider,
  emailSignoff,
  plainTextFooter,
} from "../utils";
import { getBrandName, getAppUrl } from "@/lib/branding";
import { loadTemplate } from "../template-loader";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  newSignups: number;
  walletDeposits: number; // count of Stripe charges
  walletRevenueCents: number; // total cents deposited
  activePods: number;
  activeGPUs: number;
  totalCustomers: number;
  walletBalanceCents: number; // aggregate wallet balance
  activeProviders: number;
  activeNodes: number;
  tokenInferenceRequests: number;
  tokenInputTokens: number;
  tokenOutputTokens: number;
  voucherRedemptions: number;
  referralClaims: number;
}

export interface MidnightStatusEmailParams {
  to: string;
  today: DailySnapshot;
  lastWeekSameDay: DailySnapshot;
  weekHistory: DailySnapshot[]; // last 7 days, oldest first
  mrrCents: number;
  previousMrrCents: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(current: number, previous: number): string {
  if (previous === 0 && current === 0) return "0%";
  if (previous === 0) return "+100%";
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

function pctColor(current: number, previous: number): string {
  if (current > previous) return "#10b981"; // green
  if (current < previous) return "#ef4444"; // red
  return "#5b6476"; // neutral grey
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Inline sparkline using Unicode block chars (works in all email clients) */
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const blocks = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
  return values
    .map((v) => {
      const idx = Math.min(Math.floor((v / max) * 7), 7);
      return blocks[idx];
    })
    .join("");
}

// ── KPI Row Builder ────────────────────────────────────────────────────────

function kpiRow(
  label: string,
  todayVal: string,
  lastWeekVal: string,
  changeStr: string,
  changeColor: string,
  spark: string
): string {
  return `<tr>
    <td style="padding: 10px 12px; font-size: 14px; color: #0b0f1c; border-bottom: 1px solid #f0f1f4;">${label}</td>
    <td style="padding: 10px 12px; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right; border-bottom: 1px solid #f0f1f4;">${todayVal}</td>
    <td style="padding: 10px 12px; font-size: 13px; color: #5b6476; text-align: right; border-bottom: 1px solid #f0f1f4;">${lastWeekVal}</td>
    <td style="padding: 10px 12px; font-size: 13px; font-weight: 600; color: ${changeColor}; text-align: right; border-bottom: 1px solid #f0f1f4;">${changeStr}</td>
    <td style="padding: 10px 12px; font-size: 16px; letter-spacing: 1px; font-family: monospace; color: #1a4fff; text-align: center; border-bottom: 1px solid #f0f1f4;">${spark}</td>
  </tr>`;
}

// ── Email Builder ──────────────────────────────────────────────────────────

export async function sendMidnightStatusEmail(params: MidnightStatusEmailParams): Promise<void> {
  const { to, today, lastWeekSameDay: lw, weekHistory, mrrCents, previousMrrCents } = params;

  const todayLabel = dayLabel(today.date);
  const lwLabel = dayLabel(lw.date);

  const subject = `${getBrandName()} Daily Status \u2014 ${todayLabel} \u2014 ${fmtNum(today.newSignups)} signups, ${fmtNum(today.activePods)} pods, ${fmtCents(today.walletRevenueCents)} deposited`;

  // Extract 7-day sparkline data
  const signupSpark = sparkline(weekHistory.map((d) => d.newSignups));
  const depositSpark = sparkline(weekHistory.map((d) => d.walletRevenueCents));
  const podSpark = sparkline(weekHistory.map((d) => d.activePods));
  const gpuSpark = sparkline(weekHistory.map((d) => d.activeGPUs));
  const customerSpark = sparkline(weekHistory.map((d) => d.totalCustomers));
  const balanceSpark = sparkline(weekHistory.map((d) => d.walletBalanceCents));
  const nodeSpark = sparkline(weekHistory.map((d) => d.activeNodes));
  const tokenSpark = sparkline(weekHistory.map((d) => d.tokenInferenceRequests));
  const voucherSpark = sparkline(weekHistory.map((d) => d.voucherRedemptions));
  const referralSpark = sparkline(weekHistory.map((d) => d.referralClaims));

  const body = `
    <h2 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #0b0f1c;">Daily Status Report</h2>
    <p style="margin: 0 0 24px 0; font-size: 13px; color: #5b6476;">${todayLabel} vs ${lwLabel} (same day last week)</p>

    <!-- KPI Table -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e4e7ef; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background-color: #f7f8fb;">
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #5b6476; text-align: left; text-transform: uppercase; letter-spacing: 0.5px;">KPI</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #5b6476; text-align: right; text-transform: uppercase; letter-spacing: 0.5px;">Today</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #5b6476; text-align: right; text-transform: uppercase; letter-spacing: 0.5px;">Last Wk</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #5b6476; text-align: right; text-transform: uppercase; letter-spacing: 0.5px;">Change</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #5b6476; text-align: center; text-transform: uppercase; letter-spacing: 0.5px;">7d Trend</th>
        </tr>
      </thead>
      <tbody>
        <!-- Growth -->
        <tr><td colspan="5" style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #1a4fff; text-transform: uppercase; letter-spacing: 1px; background-color: #f7f8fb;">Growth</td></tr>
        ${kpiRow("New Signups", fmtNum(today.newSignups), fmtNum(lw.newSignups), pct(today.newSignups, lw.newSignups), pctColor(today.newSignups, lw.newSignups), signupSpark)}
        ${kpiRow("Total Customers", fmtNum(today.totalCustomers), fmtNum(lw.totalCustomers), pct(today.totalCustomers, lw.totalCustomers), pctColor(today.totalCustomers, lw.totalCustomers), customerSpark)}

        <!-- Revenue -->
        <tr><td colspan="5" style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #1a4fff; text-transform: uppercase; letter-spacing: 1px; background-color: #f7f8fb;">Revenue</td></tr>
        ${kpiRow("Wallet Deposits", fmtNum(today.walletDeposits), fmtNum(lw.walletDeposits), pct(today.walletDeposits, lw.walletDeposits), pctColor(today.walletDeposits, lw.walletDeposits), depositSpark)}
        ${kpiRow("Deposit Revenue", fmtCents(today.walletRevenueCents), fmtCents(lw.walletRevenueCents), pct(today.walletRevenueCents, lw.walletRevenueCents), pctColor(today.walletRevenueCents, lw.walletRevenueCents), depositSpark)}
        ${kpiRow("MRR", fmtCents(mrrCents), fmtCents(previousMrrCents), pct(mrrCents, previousMrrCents), pctColor(mrrCents, previousMrrCents), "")}
        ${kpiRow("Aggregate Wallet Balance", fmtCents(today.walletBalanceCents), fmtCents(lw.walletBalanceCents), pct(today.walletBalanceCents, lw.walletBalanceCents), pctColor(today.walletBalanceCents, lw.walletBalanceCents), balanceSpark)}

        <!-- Infrastructure -->
        <tr><td colspan="5" style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #1a4fff; text-transform: uppercase; letter-spacing: 1px; background-color: #f7f8fb;">Infrastructure</td></tr>
        ${kpiRow("Active Pods", fmtNum(today.activePods), fmtNum(lw.activePods), pct(today.activePods, lw.activePods), pctColor(today.activePods, lw.activePods), podSpark)}
        ${kpiRow("Active GPUs", fmtNum(today.activeGPUs), fmtNum(lw.activeGPUs), pct(today.activeGPUs, lw.activeGPUs), pctColor(today.activeGPUs, lw.activeGPUs), gpuSpark)}
        ${kpiRow("Active Nodes", fmtNum(today.activeNodes), fmtNum(lw.activeNodes), pct(today.activeNodes, lw.activeNodes), pctColor(today.activeNodes, lw.activeNodes), nodeSpark)}

        <!-- Token Factory -->
        <tr><td colspan="5" style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #1a4fff; text-transform: uppercase; letter-spacing: 1px; background-color: #f7f8fb;">Token Factory</td></tr>
        ${kpiRow("Inference Requests", fmtNum(today.tokenInferenceRequests), fmtNum(lw.tokenInferenceRequests), pct(today.tokenInferenceRequests, lw.tokenInferenceRequests), pctColor(today.tokenInferenceRequests, lw.tokenInferenceRequests), tokenSpark)}

        <!-- Marketing -->
        <tr><td colspan="5" style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #1a4fff; text-transform: uppercase; letter-spacing: 1px; background-color: #f7f8fb;">Marketing</td></tr>
        ${kpiRow("Voucher Redemptions", fmtNum(today.voucherRedemptions), fmtNum(lw.voucherRedemptions), pct(today.voucherRedemptions, lw.voucherRedemptions), pctColor(today.voucherRedemptions, lw.voucherRedemptions), voucherSpark)}
        ${kpiRow("Referral Claims", fmtNum(today.referralClaims), fmtNum(lw.referralClaims), pct(today.referralClaims, lw.referralClaims), pctColor(today.referralClaims, lw.referralClaims), referralSpark)}
      </tbody>
    </table>

    ${emailDivider()}

    <!-- 7-Day History Table -->
    <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #0b0f1c;">7-Day History</h3>
    <div style="overflow-x: auto;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e4e7ef; border-radius: 8px; overflow: hidden; font-size: 12px;">
        <thead>
          <tr style="background-color: #f7f8fb;">
            <th style="padding: 8px 6px; color: #5b6476; text-align: left; font-weight: 600;">Date</th>
            <th style="padding: 8px 6px; color: #5b6476; text-align: right; font-weight: 600;">Signups</th>
            <th style="padding: 8px 6px; color: #5b6476; text-align: right; font-weight: 600;">Deposits</th>
            <th style="padding: 8px 6px; color: #5b6476; text-align: right; font-weight: 600;">Revenue</th>
            <th style="padding: 8px 6px; color: #5b6476; text-align: right; font-weight: 600;">Pods</th>
            <th style="padding: 8px 6px; color: #5b6476; text-align: right; font-weight: 600;">GPUs</th>
            <th style="padding: 8px 6px; color: #5b6476; text-align: right; font-weight: 600;">Customers</th>
          </tr>
        </thead>
        <tbody>
          ${weekHistory
            .map(
              (d, i) => `<tr style="background-color: ${i % 2 === 0 ? "#ffffff" : "#fafbfc"};">
              <td style="padding: 6px; color: #0b0f1c; white-space: nowrap;">${dayLabel(d.date)}</td>
              <td style="padding: 6px; color: #0b0f1c; text-align: right;">${fmtNum(d.newSignups)}</td>
              <td style="padding: 6px; color: #0b0f1c; text-align: right;">${fmtNum(d.walletDeposits)}</td>
              <td style="padding: 6px; color: #0b0f1c; text-align: right;">${fmtCents(d.walletRevenueCents)}</td>
              <td style="padding: 6px; color: #0b0f1c; text-align: right;">${fmtNum(d.activePods)}</td>
              <td style="padding: 6px; color: #0b0f1c; text-align: right;">${fmtNum(d.activeGPUs)}</td>
              <td style="padding: 6px; color: #0b0f1c; text-align: right;">${fmtNum(d.totalCustomers)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>

    ${emailDivider()}
    ${emailText(`<a href="${getAppUrl()}/admin?tab=business" style="color: #1a4fff;">View full dashboard \u2192</a>`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({
    preheader: `${fmtNum(today.newSignups)} signups, ${fmtNum(today.activePods)} pods, ${fmtCents(today.walletRevenueCents)} deposited`,
    body,
    isTransactional: true,
    portalLabel: "Daily Status Report",
  });

  const text = buildPlainText(params);

  const template = await loadTemplate("midnight-status", {
    newSignups: fmtNum(today.newSignups),
    totalCustomers: fmtNum(today.totalCustomers),
    walletDeposits: fmtNum(today.walletDeposits),
    walletRevenue: fmtCents(today.walletRevenueCents),
    mrr: fmtCents(mrrCents),
    walletBalance: fmtCents(today.walletBalanceCents),
    activePods: fmtNum(today.activePods),
    activeGPUs: fmtNum(today.activeGPUs),
    activeNodes: fmtNum(today.activeNodes),
    inferenceRequests: fmtNum(today.tokenInferenceRequests),
    voucherRedemptions: fmtNum(today.voucherRedemptions),
    referralClaims: fmtNum(today.referralClaims),
    todayLabel,
  }, { subject, html, text });

  await sendEmailDirect({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

// ── Plain Text Version ─────────────────────────────────────────────────────

function buildPlainText(params: MidnightStatusEmailParams): string {
  const { today, lastWeekSameDay: lw, weekHistory, mrrCents, previousMrrCents } = params;

  const lines: string[] = [
    `${getBrandName().toUpperCase()} DAILY STATUS REPORT`,
    `${dayLabel(today.date)} vs ${dayLabel(lw.date)} (same day last week)`,
    "",
    "=== GROWTH ===",
    `New Signups:      ${fmtNum(today.newSignups)} (was ${fmtNum(lw.newSignups)}, ${pct(today.newSignups, lw.newSignups)})`,
    `Total Customers:  ${fmtNum(today.totalCustomers)} (was ${fmtNum(lw.totalCustomers)}, ${pct(today.totalCustomers, lw.totalCustomers)})`,
    "",
    "=== REVENUE ===",
    `Wallet Deposits:  ${fmtNum(today.walletDeposits)} (was ${fmtNum(lw.walletDeposits)}, ${pct(today.walletDeposits, lw.walletDeposits)})`,
    `Deposit Revenue:  ${fmtCents(today.walletRevenueCents)} (was ${fmtCents(lw.walletRevenueCents)}, ${pct(today.walletRevenueCents, lw.walletRevenueCents)})`,
    `MRR:              ${fmtCents(mrrCents)} (was ${fmtCents(previousMrrCents)}, ${pct(mrrCents, previousMrrCents)})`,
    `Wallet Balance:   ${fmtCents(today.walletBalanceCents)} (was ${fmtCents(lw.walletBalanceCents)}, ${pct(today.walletBalanceCents, lw.walletBalanceCents)})`,
    "",
    "=== INFRASTRUCTURE ===",
    `Active Pods:      ${fmtNum(today.activePods)} (was ${fmtNum(lw.activePods)}, ${pct(today.activePods, lw.activePods)})`,
    `Active GPUs:      ${fmtNum(today.activeGPUs)} (was ${fmtNum(lw.activeGPUs)}, ${pct(today.activeGPUs, lw.activeGPUs)})`,
    `Active Nodes:     ${fmtNum(today.activeNodes)} (was ${fmtNum(lw.activeNodes)}, ${pct(today.activeNodes, lw.activeNodes)})`,
    "",
    "=== TOKEN FACTORY ===",
    `Inference Reqs:   ${fmtNum(today.tokenInferenceRequests)} (was ${fmtNum(lw.tokenInferenceRequests)}, ${pct(today.tokenInferenceRequests, lw.tokenInferenceRequests)})`,
    "",
    "=== MARKETING ===",
    `Voucher Redeemed: ${fmtNum(today.voucherRedemptions)} (was ${fmtNum(lw.voucherRedemptions)}, ${pct(today.voucherRedemptions, lw.voucherRedemptions)})`,
    `Referral Claims:  ${fmtNum(today.referralClaims)} (was ${fmtNum(lw.referralClaims)}, ${pct(today.referralClaims, lw.referralClaims)})`,
    "",
    "=== 7-DAY HISTORY ===",
    "Date           | Signups | Deposits | Revenue    | Pods | GPUs | Customers",
    "-".repeat(80),
  ];

  for (const d of weekHistory) {
    lines.push(
      `${dayLabel(d.date).padEnd(14)} | ${String(d.newSignups).padStart(7)} | ${String(d.walletDeposits).padStart(8)} | ${fmtCents(d.walletRevenueCents).padStart(10)} | ${String(d.activePods).padStart(4)} | ${String(d.activeGPUs).padStart(4)} | ${String(d.totalCustomers).padStart(9)}`
    );
  }

  lines.push("", `View full dashboard: ${getAppUrl()}/admin?tab=business`);
  lines.push(plainTextFooter());

  return lines.join("\n");
}
