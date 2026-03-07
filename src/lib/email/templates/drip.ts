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
 *     1. (6h)   Your API key is live + $25 credit applied
 *     2. (48h)  Ship faster with batch, embeddings & structured outputs
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

// ── Default brand values used when no branding is supplied ──────────────────
const DEFAULT_BRAND_NAME = 'GPU Cloud';
const DEFAULT_API_BASE_URL = 'https://api.example.com';

// ── GPU display names + pricing (kept in sync with signup route) ──

const GPU_INFO: Record<string, { name: string; price: string; vram: string }> = {
  b200:           { name: "NVIDIA B200",               price: "$2.25/hr", vram: "180 GB HBM3e" },
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
    ${emailMuted("Your account also includes 10,000 free API tokens for LLM inference. No payment required to try the API.")}
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

Your account also includes 10,000 free API tokens for LLM inference. No payment required to try the API.

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
  const apiBase = branding?.apiBaseUrl || DEFAULT_API_BASE_URL;

  const subject = creditApplied
    ? "$25 credit + 10K free tokens — your account is ready"
    : "Your API key is live — first call in 30 seconds";

  const creditBlock = creditApplied ? `
    ${emailSuccessBox(`
      <p style="margin: 0; font-size: 16px; font-weight: 600; color: #065f46;">$25.00 welcome credit applied</p>
      <p style="margin: 6px 0 0 0; font-size: 14px; color: #047857;">Already in your wallet — use it on GPUs anytime, no card required.</p>
    `)}
  ` : "";

  const body = `
    ${emailGreeting(customerName)}
    ${creditBlock}
    ${emailText(`Your ${brand} account is set up with <strong>10,000 free tokens</strong>. Here's the fastest way to use them:`)}
    ${emailInfoBox(`
      <p style="margin: 0 0 12px 0; font-size: 14px; font-family: 'SF Mono', Menlo, monospace; color: #0b0f1c; font-weight: 600;">curl</p>
      <p style="margin: 0 0 4px 0; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; color: #5b6476;">&nbsp;&nbsp;${apiBase}/v1/chat/completions \\</p>
      <p style="margin: 0 0 4px 0; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; color: #5b6476;">&nbsp;&nbsp;-H "Authorization: Bearer YOUR_KEY" \\</p>
      <p style="margin: 0 0 4px 0; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; color: #5b6476;">&nbsp;&nbsp;-H "Content-Type: application/json" \\</p>
      <p style="margin: 0; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; color: #5b6476;">&nbsp;&nbsp;-d '{"model":"meta-llama/Llama-3.3-70B-Instruct",<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"messages":[{"role":"user","content":"Hello"}]}'</p>
    `)}
    ${emailText("It's <strong>OpenAI-compatible</strong>. Change the base URL in your existing code and it works — OpenAI SDK, LangChain, LlamaIndex, anything.")}
    ${emailButton("Open Dashboard", dashboardUrl, branding)}
    ${emailMuted("Your API key is in the API Keys tab. Or just use the built-in playground to test without code.")}
    ${emailSignoff(branding)}
  `;

  const creditPlainText = creditApplied ? "\n$25.00 WELCOME CREDIT APPLIED\nAlready in your wallet — use it on GPUs anytime, no card required.\n" : "";
  const fallbackHtml = emailLayout({ preheader: creditApplied ? "$25 credit + 10K free tokens — get started" : "10,000 free tokens — make your first API call", body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},
${creditPlainText}
Your ${brand} account is set up with 10,000 free tokens. Here's the fastest way to use them:

curl ${apiBase}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"meta-llama/Llama-3.3-70B-Instruct","messages":[{"role":"user","content":"Hello"}]}'

It's OpenAI-compatible. Change the base URL in your existing code and it works — OpenAI SDK, LangChain, LlamaIndex, anything.

Open Dashboard: ${dashboardUrl}

Your API key is in the API Keys tab. Or just use the built-in playground to test without code.

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

  const subject = "Ship faster: batch, embeddings, and structured outputs";
  const body = `
    ${emailGreeting(customerName)}
    ${emailText("Beyond chat completions, three features that help teams ship faster:")}
    <div style="margin: 20px 0;">
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Batch Processing</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Send thousands of prompts in one request. 50% cheaper than real-time. Results delivered async — ideal for data pipelines, evals, and content generation at scale.</p>
      </div>
      <div style="padding: 14px 0; border-bottom: 1px solid #e4e7ef;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Embeddings</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">Generate vectors with nomic-embed or BGE models. Build RAG, semantic search, or recommendations with a single API call.</p>
      </div>
      <div style="padding: 14px 0;">
        <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0b0f1c;">Structured Outputs</p>
        <p style="margin: 0; font-size: 14px; color: #5b6476;">JSON mode + JSON schema validation. Get reliable structured data from any model — no regex parsing, no retries.</p>
      </div>
    </div>
    ${emailText("All of this works with your free tokens. No payment required.")}
    ${emailButton("Try It Now", dashboardUrl, branding)}
    ${emailMuted("Reply to this email if you want help integrating — we've helped teams migrate from OpenAI, Together, and Replicate.")}
    ${emailSignoff(branding)}
  `;

  const fallbackHtml = emailLayout({ preheader: "Batch 50% cheaper, embeddings, JSON schema — all free to try", body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},

Beyond chat completions, three features that help teams ship faster:

1. Batch Processing
Send thousands of prompts in one request. 50% cheaper than real-time. Ideal for data pipelines, evals, and content generation.

2. Embeddings
Generate vectors with nomic-embed or BGE. Build RAG, semantic search, or recommendations.

3. Structured Outputs
JSON mode + JSON schema validation. Reliable structured data, no regex parsing.

All of this works with your free tokens. No payment required.

Try It Now: ${dashboardUrl}

Reply if you want help integrating — we've helped teams migrate from OpenAI, Together, and Replicate.

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
    ${emailText("When you need more than API calls — fine-tuning, custom model serving, or running your own stack — a dedicated GPU is the next step.")}
    ${emailInfoBox(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #5b6476;">RTX PRO 6000</td>
          <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">$0.66/hr &middot; 96 GB</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #5b6476;">NVIDIA B200</td>
          <td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">$2.25/hr &middot; 180 GB</td>
        </tr>
      </table>
    `)}
    ${emailText("$25 gets you <strong>37+ hours</strong> on an RTX PRO 6000 or <strong>11 hours</strong> on a B200. Enough to run a real workload.")}
    ${emailButtonTeal("Launch a GPU", dashboardUrl, branding)}
    ${emailMuted("This credit expires in 30 days. No payment method needed. Your free API tokens are still there too.")}
    ${emailSignoff(branding)}
  `;

  const fallbackHtml = emailLayout({ preheader: "$25 credit waiting — launch a dedicated GPU, no card required", body, unsubscribeUrl, branding });
  const fallbackText = `Hi ${customerName},

Just a reminder — you have $25.00 in your ${brand} wallet. It's ready to use, no card required.

When you need more than API calls — fine-tuning, custom model serving, or your own stack — a dedicated GPU is the next step.

RTX PRO 6000: $0.66/hr, 96 GB
NVIDIA B200: $2.25/hr, 180 GB

$25 gets you 37+ hours on an RTX PRO 6000 or 11 hours on a B200.

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
