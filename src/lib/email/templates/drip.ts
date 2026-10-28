/**
 * Drip Campaign Email Templates — V2
 *
 * Product-aware onboarding sequence. Two verticals:
 *
 *   GPU vertical  (user signed up from a GPU landing page)
 *     1. (6h)   Inventory is live + $25 credit applied — deploy your [GPU]
 *     2. (48h)  What teams ship on [GPU]
 *     3. (120h) Credit reminder — your $25 is still waiting
 *
 *   API vertical  (direct signup, no GPU context)
 *     1. (6h)   Your account is ready — browse GPU inventory
 *     2. (48h)  Three things you can do from the dashboard today
 *     3. (120h) Credit reminder — try a dedicated GPU
 *
 * All emails follow DigitalOcean/Vercel style: short, developer-focused,
 * single CTA, zero fluff, progressive urgency toward conversion.
 */

import { sendEmail } from "../client";
import { loadTemplate } from "../template-loader";
import type { EmailBranding } from "../tenant-branding";
import {
  emailLayout,
  emailGreeting,
  emailText,
  emailButton,
  emailButtonTeal,
  emailInfoBox,
  emailSuccessBox,
  emailSignoff,
  emailMuted,
  plainTextFooter,
} from "../utils";
import { getBrandName } from "@/lib/branding";

// ── Default brand values used when no branding is supplied ──────────────────
const DEFAULT_BRAND_NAME = getBrandName();

// ── GPU display names + pricing (kept in sync with signup route) ──

const GPU_INFO: Record<string, { name: string; price: string; vram: string }> = {
  b200:           { name: "NVIDIA B200",               price: "$3.75/hr", vram: "180 GB HBM3e" },
  h200:           { name: "NVIDIA H200",               price: "$2.49/hr", vram: "141 GB HBM3e" },
  h100:           { name: "NVIDIA H100",               price: "$2.49/hr", vram: "80 GB HBM3"   },
  "rtx-pro-6000": { name: "RTX PRO 6000",             price: "$0.66/hr", vram: "96 GB GDDR7"  },
  rtx6000:        { name: "RTX PRO 6000",             price: "$0.66/hr", vram: "96 GB GDDR7"  },
};

function getGpuInfo(gpu: string) {
  return GPU_INFO[gpu] || { name: gpu.toUpperCase(), price: "competitive pricing", vram: "" };
}

// ═══════════════════════════════════════════════════════════════════════════
//  GPU VERTICAL
// ═══════════════════════════════════════════════════════════════════════════

// ── GPU Email 1: Inventory is live (6h) ──

export async function sendDripGpu1(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  gpu: string;
  creditApplied?: boolean;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}) {
  const { to, customerName, dashboardUrl, gpu, creditApplied, unsubscribeUrl, branding } = params;
  const info = getGpuInfo(gpu);
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  const subject = creditApplied
    ? `$25 credit + ${info.name} ready — deploy in 5 minutes`
    : `${info.name} inventory is live — deploy in 5 minutes`;

  const creditBlock = creditApplied ? `
    ${emailSuccessBox(`
      <p style="margin: 0; font-size: 16px; font-weight: 600; color: #065f46;">$25.00 welcome credit applied</p>
      <p style="margin: 6px 0 0 0; font-size: 14px; color: #047857;">Already in your wallet — no card required to use it.</p>
    `)}
  ` : "";

  const body = `
    ${emailGreeting(customerName)}
    ${creditBlock}
    ${emailText(`You signed up looking at the <strong>${info.name}</strong>. Good news — we have instances available right now.`)}
    ${emailInfoBox(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #5b6476;">GPU</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${info.name}</td>
        </tr>
        ${info.vram ? `<tr>
          <td style="padding: 4px 0; font-size: 14px; color: #5b6476;">Memory</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${info.vram}</td>
        </tr>` : ""}
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #5b6476;">Price</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${info.price}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #5b6476;">Availability</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #10b981; text-align: right;">In stock</td>
        </tr>
      </table>
    `)}
    ${emailText("On-demand, not spot. No bidding, no interruptions. SSH in and start working.")}
    ${emailButton("Deploy Now", dashboardUrl, branding)}
    ${emailSignoff(branding)}
  `;

  const creditPlainText = creditApplied ? "\n$25.00 WELCOME CREDIT APPLIED\nAlready in your wallet — no card required.\n" : "";
  const fallbackHtml = emailLayout({ preheader: creditApplied ? `$25 credit + ${info.name} available now` : `${info.name} available now — ${info.price}`, body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},
${creditPlainText}
You signed up looking at the ${info.name}. Good news — we have instances available right now.

GPU: ${info.name}
${info.vram ? `Memory: ${info.vram}\n` : ""}Price: ${info.price}
Availability: In stock

On-demand, not spot. No bidding, no interruptions. SSH in and start working.

Deploy Now: ${dashboardUrl}

The ${brand} Team
${plainTextFooter({ unsubscribeUrl, branding })}`;

  const template = await loadTemplate(
    "drip-gpu-1-inventory",
    { customerName, dashboardUrl, gpuName: info.name, gpuPrice: info.price, gpuVram: info.vram },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

// ── GPU Email 2: What teams ship on this GPU (48h) ──

export async function sendDripGpu2(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  gpu: string;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}) {
  const { to, customerName, dashboardUrl, gpu, unsubscribeUrl, branding } = params;
  const info = getGpuInfo(gpu);
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  // Pick use cases relevant to the GPU tier
  const isHighEnd = ["b200", "h200", "h100"].includes(gpu);

  const useCases = isHighEnd
    ? `
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Fine-tune LLMs</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">LoRA and full fine-tuning on Llama 3, Mistral, Qwen. ${info.vram} of VRAM fits 70B+ parameter models.</p>
      </div>
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Serve production inference</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Run vLLM, TGI, or TensorRT-LLM with your own models. Full root access, no platform lock-in.</p>
      </div>
      <div style="padding: 14px 0;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Train from scratch</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Multi-GPU training with NVLink. Scale to clusters when you need more than one node.</p>
      </div>
    `
    : `
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Run open-source models</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Serve Llama 3 8B, Mistral 7B, or Stable Diffusion XL locally with vLLM or Ollama. ${info.vram} fits most popular models.</p>
      </div>
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Fine-tune with LoRA</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Train custom adapters on your data. Great for domain-specific chatbots, code generation, and classification.</p>
      </div>
      <div style="padding: 14px 0;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Build AI applications</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">ComfyUI, Automatic1111, or your own stack. Full root + Docker, no restrictions.</p>
      </div>
    `;

  const subject = `What developers build on ${info.name}`;
  const body = `
    ${emailGreeting(customerName)}
    ${emailText(`Here's what teams are shipping on the ${info.name}:`)}
    <div style="margin: 20px 0;">
      ${useCases}
    </div>
    ${emailText("Every instance comes with full root access, persistent storage, and a 99.9% uptime SLA. No spot interruptions.")}
    ${emailButton("Browse Inventory", dashboardUrl, branding)}
    ${emailMuted("Reply to this email if you have questions about your workload — we'll help you pick the right config.")}
    ${emailSignoff(branding)}
  `;

  const fallbackHtml = emailLayout({ preheader: `Fine-tuning, inference, training — what you can do with ${info.name}`, body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},

Here's what teams are shipping on the ${info.name}:

${isHighEnd ? `Fine-tune LLMs — LoRA and full fine-tuning. ${info.vram} fits 70B+ models.
Serve production inference — vLLM, TGI, or TensorRT-LLM. Full root access.
Train from scratch — Multi-GPU training with NVLink.` : `Run open-source models — Llama 3, Mistral, Stable Diffusion with vLLM or Ollama.
Fine-tune with LoRA — Train custom adapters on your data.
Build AI applications — ComfyUI, Automatic1111, or your own stack.`}

Every instance: full root access, persistent storage, 99.9% uptime SLA.

Browse Inventory: ${dashboardUrl}

Reply to this email if you have questions — we'll help you pick the right config.

The ${brand} Team
${plainTextFooter({ unsubscribeUrl, branding })}`;

  const template = await loadTemplate(
    "drip-gpu-2-usecases",
    { customerName, dashboardUrl, gpuName: info.name },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

// ── GPU Email 3: Credit reminder (120h) ──

export async function sendDripGpu3(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  gpu: string;
  creditApplied: boolean;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}) {
  const { to, customerName, dashboardUrl, gpu, unsubscribeUrl, branding } = params;
  const info = getGpuInfo(gpu);
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  const subject = `Your $25 credit is still waiting — deploy your ${info.name}`;

  const body = `
    ${emailGreeting(customerName)}
    ${emailText(`Just a reminder — you have <strong>$25.00</strong> in your ${brand} wallet. It's ready to use, no card required.`)}
    ${emailText(`At <strong>${info.price}</strong>, that's ${getHoursEstimate(gpu)} of ${info.name} compute — enough to test a deployment, run a fine-tuning job, or benchmark your workload.`)}
    ${emailButtonTeal("Launch a GPU", dashboardUrl, branding)}
    ${emailInfoBox(`
      <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">How to use your credit:</p>
      <p style="margin: 0 0 4px 0; font-size: 14px; color: #5b6476;">1. Log in to your dashboard</p>
      <p style="margin: 0 0 4px 0; font-size: 14px; color: #5b6476;">2. Pick a GPU and configure your instance</p>
      <p style="margin: 0; font-size: 14px; color: #5b6476;">3. Deploy — your $25 credit covers the cost</p>
    `)}
    ${emailMuted("This credit expires in 30 days. No payment method needed to use it.")}
    ${emailSignoff(branding)}
  `;

  const fallbackHtml = emailLayout({ preheader: `$25 credit waiting — deploy ${info.name} today`, body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},

Just a reminder — you have $25.00 in your ${brand} wallet. It's ready to use, no card required.

At ${info.price}, that's ${getHoursEstimate(gpu)} of ${info.name} compute — enough to test a deployment, run a fine-tuning job, or benchmark your workload.

Launch a GPU: ${dashboardUrl}

How to use your credit:
1. Log in to your dashboard
2. Pick a GPU and configure your instance
3. Deploy — your $25 credit covers the cost

This credit expires in 30 days. No payment method needed to use it.

The ${brand} Team
${plainTextFooter({ unsubscribeUrl, branding })}`;

  const template = await loadTemplate(
    "drip-gpu-3-credit",
    { customerName, dashboardUrl, gpuName: info.name, gpuPrice: info.price },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

// ═══════════════════════════════════════════════════════════════════════════
//  API VERTICAL
// ═══════════════════════════════════════════════════════════════════════════

// ── API Email 1: Your key is live (6h) ──

export async function sendDripApi1(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  creditApplied?: boolean;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}) {
  const { to, customerName, dashboardUrl, creditApplied, unsubscribeUrl, branding } = params;
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  const subject = creditApplied
    ? `$25 credit applied — your ${brand} account is ready`
    : `Your ${brand} account is ready — browse GPU inventory`;

  const creditBlock = creditApplied ? `
    ${emailSuccessBox(`
      <p style="margin: 0; font-size: 16px; font-weight: 600; color: #065f46;">$25.00 welcome credit applied</p>
      <p style="margin: 6px 0 0 0; font-size: 14px; color: #047857;">Already in your wallet — use it on GPUs anytime, no card required.</p>
    `)}
  ` : "";

  const body = `
    ${emailGreeting(customerName)}
    ${creditBlock}
    ${emailText(`Your ${brand} account is set up. Head to the dashboard to browse live GPU inventory, check real-time pricing, and deploy a pod when you're ready.`)}
    ${emailInfoBox(`
      <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">What you can do today</p>
      <p style="margin: 0 0 4px 0; font-size: 14px; color: #5b6476;">&middot; Browse the full GPU inventory with live pricing</p>
      <p style="margin: 0 0 4px 0; font-size: 14px; color: #5b6476;">&middot; Save deployment configurations for later</p>
      <p style="margin: 0; font-size: 14px; color: #5b6476;">&middot; Deploy a dedicated pod from $0.66/hr</p>
    `)}
    ${emailButton("Open Dashboard", dashboardUrl, branding)}
    ${emailMuted("Reply if you want help picking the right GPU for your workload — happy to chat.")}
    ${emailSignoff(branding)}
  `;

  const creditPlainText = creditApplied ? "\n$25.00 WELCOME CREDIT APPLIED\nAlready in your wallet — use it on GPUs anytime, no card required.\n" : "";
  const fallbackHtml = emailLayout({ preheader: creditApplied ? "$25 credit waiting — browse GPU inventory" : "Your account is ready — browse GPU inventory", body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},
${creditPlainText}
Your ${brand} account is set up. Head to the dashboard to browse live GPU inventory, check real-time pricing, and deploy a pod when you're ready.

What you can do today:
- Browse the full GPU inventory with live pricing
- Save deployment configurations for later
- Deploy a dedicated pod from $0.66/hr

Open Dashboard: ${dashboardUrl}

Reply if you want help picking the right GPU for your workload — happy to chat.

The ${brand} Team
${plainTextFooter({ unsubscribeUrl, branding })}`;

  const template = await loadTemplate(
    "drip-api-1-quickstart",
    { customerName, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

// ── API Email 2: Feature discovery (48h) ──

export async function sendDripApi2(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}) {
  const { to, customerName, dashboardUrl, unsubscribeUrl, branding } = params;
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  const subject = "Three things you can do from the dashboard today";
  const body = `
    ${emailGreeting(customerName)}
    ${emailText(`A quick tour of what's waiting for you in ${brand}:`)}
    <div style="margin: 20px 0;">
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Live GPU inventory</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">RTX PRO 6000, H100, H200, B200 — see what's available and what it costs, updated in real time.</p>
      </div>
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">One-click Hugging Face deploys</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Pick a model, pick a pod, hit deploy. We wire up vLLM, SSH, and an exposed endpoint for you.</p>
      </div>
      <div style="padding: 14px 0;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Per-second billing from your wallet</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">No subscriptions, no commitments. Top up the wallet, run a pod, stop when you're done.</p>
      </div>
    </div>
    ${emailButton("Open Dashboard", dashboardUrl, branding)}
    ${emailMuted("Reply if you want help picking a GPU for your workload — happy to chat.")}
    ${emailSignoff(branding)}
  `;

  const fallbackHtml = emailLayout({ preheader: "Live inventory, one-click deploys, per-second billing", body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},

A quick tour of what's waiting for you in ${brand}:

1. Live GPU inventory
RTX PRO 6000, H100, H200, B200 — see what's available and what it costs, updated in real time.

2. One-click Hugging Face deploys
Pick a model, pick a pod, hit deploy. We wire up vLLM, SSH, and an exposed endpoint for you.

3. Per-second billing from your wallet
No subscriptions, no commitments. Top up the wallet, run a pod, stop when you're done.

Open Dashboard: ${dashboardUrl}

Reply if you want help picking a GPU for your workload — happy to chat.

The ${brand} Team
${plainTextFooter({ unsubscribeUrl, branding })}`;

  const template = await loadTemplate(
    "drip-api-2-features",
    { customerName, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

// ── API Email 3: Credit reminder — graduate to GPU (120h) ──

export async function sendDripApi3(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  creditApplied: boolean;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}) {
  const { to, customerName, dashboardUrl, unsubscribeUrl, branding } = params;
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  const subject = "Your $25 credit is still waiting — try a dedicated GPU";

  const body = `
    ${emailGreeting(customerName)}
    ${emailText(`Just a reminder — you have <strong>$25.00</strong> in your ${brand} wallet. It's ready to use, no card required.`)}
    ${emailText("Whether you're fine-tuning, serving your own model, or running a full training stack, a dedicated GPU is the next step.")}
    ${emailInfoBox(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #5b6476;">RTX PRO 6000</td>
          <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">$0.66/hr &middot; 96 GB</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #5b6476;">NVIDIA B200</td>
          <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">$3.75/hr &middot; 180 GB</td>
        </tr>
      </table>
    `)}
    ${emailText("$25 gets you <strong>37+ hours</strong> on an RTX PRO 6000 or <strong>8+ hours</strong> on a B200. Enough to run a real workload.")}
    ${emailButtonTeal("Launch a GPU", dashboardUrl, branding)}
    ${emailMuted("This credit expires in 30 days. No payment method needed.")}
    ${emailSignoff(branding)}
  `;

  const fallbackHtml = emailLayout({ preheader: "$25 credit waiting — launch a dedicated GPU, no card required", body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},

Just a reminder — you have $25.00 in your ${brand} wallet. It's ready to use, no card required.

Whether you're fine-tuning, serving your own model, or running a full training stack, a dedicated GPU is the next step.

RTX PRO 6000: $0.66/hr, 96 GB
NVIDIA B200: $3.75/hr, 180 GB

$25 gets you 37+ hours on an RTX PRO 6000 or 6+ hours on a B200.

Launch a GPU: ${dashboardUrl}

This credit expires in 30 days. No payment method needed.

The ${brand} Team
${plainTextFooter({ unsubscribeUrl, branding })}`;

  const template = await loadTemplate(
    "drip-api-3-credit",
    { customerName, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

// ── Helper: estimate hours from $25 credit ──

function getHoursEstimate(gpu: string): string {
  const rates: Record<string, number> = {
    b200: 225,
    h200: 249,
    h100: 249,
    "rtx-pro-6000": 66,
    rtx6000: 66,
  };
  const rateCents = rates[gpu] || 200;
  const hours = Math.floor(2500 / rateCents);
  return `${hours}+ hours`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEGACY EXPORTS (kept for backwards compat with existing DripStep records)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendDripDay1(params: { to: string; customerName: string; dashboardUrl: string }) {
  return sendDripApi1(params);
}

export async function sendDripDay3(params: { to: string; customerName: string; dashboardUrl: string }) {
  return sendDripApi2(params);
}

export async function sendDripDay7(params: { to: string; customerName: string; dashboardUrl: string }) {
  return sendDripApi3({ ...params, creditApplied: false });
}

export async function sendDripDay14(params: { to: string; customerName: string; dashboardUrl: string }) {
  return sendDripApi3({ ...params, creditApplied: false });
}
