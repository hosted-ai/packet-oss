import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { generateCustomerToken } from "@/lib/customer-auth";
import { generateApiKey } from "@/lib/api";
import { sendEmail, escapeHtml } from "@/lib/email";
import { loadTemplate } from "@/lib/email/template-loader";
import { isPro } from "@/lib/edition";
import {
  createTeam,
  createOneTimeLogin,
  syncTeamsToDefaultPolicy,
  ensureDefaultPolicies,
  ensureRoles,
} from "@/lib/hostedai";
import { logAccountCreated, logApiKeyCreated } from "@/lib/activity";
import { sendOnboardingEvent } from "@/lib/email/onboarding-events";
import { cacheCustomer } from "@/lib/customer-cache";
import { getBrandName, getDashboardUrl, getCompanyName } from "@/lib/branding";
import { sendLoginEmailForCustomer } from "@/lib/customer-login-email";
import { isBlockedDomain } from "@/lib/email-blocklist";
import crypto from "crypto";

const FREE_TRIAL_TOKENS = 10000;

// Generate a secure password for hosted.ai account
function generateSecurePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

const GPU_DISPLAY_NAMES: Record<string, string> = {
  b200: "NVIDIA B200",
  h200: "NVIDIA H200",
  h100: "NVIDIA H100",
  "rtx-pro-6000": "NVIDIA RTX PRO 6000",
  rtx6000: "NVIDIA RTX PRO 6000",
};

async function sendWelcomeAccountEmail(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
  apiKey: string;
  gpu?: string;
}) {
  const { to, customerName, dashboardUrl, apiKey, gpu } = params;
  const safeCustomerName = escapeHtml(customerName);
  const gpuName = gpu ? (GPU_DISPLAY_NAMES[gpu] || gpu.toUpperCase()) : "";
  const hasGpu = !!gpu;

  const subject = hasGpu
    ? `Your ${getBrandName()} account is ready — deploy ${gpuName}`
    : `Your ${getBrandName()} account is ready`;

  const introParagraph = hasGpu
    ? `Your ${getBrandName()} account has been created. You were looking at <strong>${gpuName}</strong> — your dashboard is ready for you to browse live inventory, check pricing, and deploy when you're ready.`
    : `Your ${getBrandName()} account has been created. You have 10,000 tokens included to explore our Token Factory LLM inference API.`;

  const ctaText = hasGpu ? "Browse GPU Inventory" : "Open Dashboard";

  const bulletPoints = hasGpu
    ? `<li>Browse live GPU inventory with real-time pricing</li>
            <li>Configure and save deployment settings</li>
            <li>Use 10,000 free tokens for LLM inference</li>
            <li>Add $50 to your wallet when you're ready to deploy</li>`
    : `<li>Use the Token Factory playground for LLM inference</li>
            <li>Make OpenAI-compatible API calls</li>
            <li>Create batch processing jobs</li>`;

  const bulletPointsText = hasGpu
    ? `- Browse live GPU inventory with real-time pricing
- Configure and save deployment settings
- Use 10,000 free tokens for LLM inference
- Add $50 to your wallet when you're ready to deploy`
    : `- Use the Token Factory playground for LLM inference
- Make OpenAI-compatible API calls
- Create batch processing jobs`;

  const closingParagraph = hasGpu
    ? `Your account is completely free. When you're ready to launch a GPU, add $50 to your wallet from the Billing tab.`
    : `Need dedicated GPU instances? You can add funds to your wallet from the Billing tab in your dashboard.`;

  const fallbackHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #000; margin: 0; font-size: 28px;">${getBrandName()}</h1></div>
  <h2 style="color: #000; font-size: 22px;">Hi ${safeCustomerName},</h2>
  <p style="font-size: 16px;">${introParagraph}</p>
  <div style="text-align: center; margin: 30px 0;">
    <a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #1A4FFF 0%, #0D3FD9 100%); color: #fff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">${ctaText}</a>
  </div>
  <div style="background: #f8f8f8; border-radius: 8px; padding: 20px; margin: 25px 0;">
    <p style="margin: 0 0 10px; font-size: 14px; color: #333; font-weight: 600;">Your API Key:</p>
    <code style="display: block; background: #fff; border: 1px solid #ddd; padding: 12px; border-radius: 4px; font-size: 13px; word-break: break-all;">${apiKey}</code>
    <p style="margin: 10px 0 0; font-size: 12px; color: #666;">Store this key securely. You can generate additional keys from your dashboard.</p>
  </div>
  <p style="font-size: 15px;">With your account you can:</p>
  <ul style="font-size: 15px; color: #555; padding-left: 20px;">${bulletPoints}</ul>
  <p style="font-size: 14px; color: #666; margin-top: 25px;">${closingParagraph}</p>
  <p style="color: #888; font-size: 14px; margin-top: 20px;">This login link expires in 1 hour. You can request a new one anytime at <a href="${getDashboardUrl()}/account" style="color: #1A4FFF;">${getDashboardUrl()}/account</a></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 13px; text-align: center;"><strong>The ${getBrandName()} Team</strong></p>
  <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #9ca3af; font-size: 12px;">
    <p style="margin: 0 0 8px 0;">${getBrandName()}${getCompanyName() ? ` by ${getCompanyName()}` : ''}</p>
    <p style="margin: 0 0 8px 0;">622 North 9th Street, San Jose, CA 95112, USA</p>
    <p style="margin: 0; font-size: 11px;">This is a transactional email related to your ${getBrandName()} account.</p>
  </div>
</body>
</html>`;

  const fallbackText = `Hi ${customerName},

${hasGpu ? `Your ${getBrandName()} account has been created. You were looking at ${gpuName} — your dashboard is ready for you to browse live inventory, check pricing, and deploy when you're ready.` : `Your ${getBrandName()} account has been created. You have 10,000 tokens included to explore our Token Factory LLM inference API.`}

${ctaText}: ${dashboardUrl}

Your API Key:
${apiKey}

Store this key securely. You can generate additional keys from your dashboard.

With your account you can:
${bulletPointsText}

${closingParagraph}

This login link expires in 1 hour. You can request a new one anytime at ${getDashboardUrl()}/account

The ${getBrandName()} Team

---
${getBrandName()}${getCompanyName() ? ` by ${getCompanyName()}` : ''}
622 North 9th Street, San Jose, CA 95112, USA
This is a transactional email related to your ${getBrandName()} account.`;

  const template = await loadTemplate(
    "signup-welcome",
    { customerName: safeCustomerName, dashboardUrl, apiKey, gpuName },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

export async function POST(request: NextRequest) {
  // Rate limit: 3 requests per minute per IP (strict for signup)
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`signup:${ip}`, {
    maxRequests: 3,
    windowMs: 60000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email, termsAccepted, gpu, plan, utm, sessionId } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!termsAccepted) {
      return NextResponse.json(
        { error: "You must accept the Terms of Service and Privacy Policy" },
        { status: 400 }
      );
    }

    const customerEmail = email.toLowerCase().trim();

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    // Check email domain blocklist (fails open if DB unavailable)
    if (await isBlockedDomain(customerEmail)) {
      return NextResponse.json(
        { error: "Signups from this email domain are not allowed. Please use a different email address." },
        { status: 400 }
      );
    }

    const stripe = await getStripe();

    // Check if customer already exists
    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      // Customer already exists — send them a login link instead of creating
      // a duplicate account. The response is deliberately identical to the
      // new-account path so we don't leak account existence.
      console.log(`[Signup] Existing customer found for ${customerEmail}, sending login link instead`);
      try {
        await sendLoginEmailForCustomer(customerEmail);
      } catch (loginEmailError) {
        console.error(`[Signup] Failed to send login email for existing customer ${customerEmail}:`, loginEmailError);
      }
      return NextResponse.json({
        success: true,
        message: "Account created! Check your email for your dashboard link and API key.",
        redirect: `${process.env.NEXT_PUBLIC_APP_URL}/success?type=existing&email=${encodeURIComponent(customerEmail)}`,
      });
    }

    // Create customer name from email
    const rawName = customerEmail.split("@")[0];
    const customerName = rawName.replace(/[^a-zA-Z0-9- ]/g, "").trim() || "User";

    console.log(`=== FREE SIGNUP: Creating account for ${customerEmail}${gpu ? ` (from GPU: ${gpu})` : ""} ===`);

    // Create Stripe customer (no charge, no balance credit)
    const signupSource = gpu ? `gpu-${gpu}` : "direct";
    const stripeCustomer = await stripe.customers.create({
      email: customerEmail,
      name: customerName,
      metadata: {
        billing_type: "free",
        free_tokens_limit: FREE_TRIAL_TOKENS.toString(),
        source: getBrandName(),
        signup_type: "free",
        signup_source: signupSource,
        ...(gpu ? { signup_gpu: gpu } : {}),
        ...(plan ? { signup_plan: plan } : {}),
        // UTM attribution (first-touch, from localStorage)
        ...(utm?.utm_source ? { utm_source: String(utm.utm_source).slice(0, 200) } : {}),
        ...(utm?.utm_medium ? { utm_medium: String(utm.utm_medium).slice(0, 200) } : {}),
        ...(utm?.utm_campaign ? { utm_campaign: String(utm.utm_campaign).slice(0, 200) } : {}),
        ...(utm?.utm_content ? { utm_content: String(utm.utm_content).slice(0, 200) } : {}),
        ...(utm?.utm_term ? { utm_term: String(utm.utm_term).slice(0, 200) } : {}),
        ...(utm?.landing_page ? { landing_page: String(utm.landing_page).slice(0, 500) } : {}),
        ...(utm?.referrer ? { referrer: String(utm.referrer).slice(0, 500) } : {}),
      },
    });
    cacheCustomer(stripeCustomer).catch(() => {});
    console.log(`✅ Created Stripe customer: ${stripeCustomer.id}`);

    // Create hosted.ai team for free trial user (same as paid users)
    const generatedPassword = generateSecurePassword();
    const teamName = `${customerName}-free-${Date.now()}`;

    let team: { id: string; name: string };
    try {
      // Await policies and roles from the API (not sync fallback) so team
      // creation never uses stale staging UUIDs on cold start.
      const [policies, roles] = await Promise.all([
        ensureDefaultPolicies(),
        ensureRoles(),
      ]);

      team = await createTeam({
        name: teamName,
        description: `${getBrandName()} - Free Trial`,
        color: "#6366F1",
        members: [
          {
            email: customerEmail,
            name: customerName,
            role: roles.teamAdmin,
            send_email_invite: false,
            password: generatedPassword,
            pre_onboard: true,
          },
        ],
        pricing_policy_id: policies.pricing,
        resource_policy_id: policies.resource,
        service_policy_id: policies.service,
        instance_type_policy_id: policies.instanceType,
        image_policy_id: policies.image,
      });
      console.log(`✅ Created hosted.ai team ${team.id} for free trial`);

      // CRITICAL: Add team to resource policy's teams array
      // Without this, the team cannot access GPU pools (error: "unable to retrieve resource access permissions")
      try {
        await syncTeamsToDefaultPolicy([team.id]);
        console.log(`✅ Added team ${team.id} to default resource policy`);
      } catch (policyError) {
        console.error(`⚠️ WARNING: Failed to add team to resource policy:`, policyError);
        // Don't throw - team is created, they just might have access issues until manually fixed
      }
    } catch (teamError) {
      console.error("❌ FATAL: Failed to create hosted.ai team for free trial:", teamError);
      throw new Error(`Failed to create hosted.ai team: ${teamError instanceof Error ? teamError.message : String(teamError)}`);
    }

    // Create one-time login token (roles already fetched above)
    try {
      const signupRoles = await ensureRoles();
      await createOneTimeLogin({
        email: customerEmail,
        send_email_invite: false,
        teamId: team.id,
        roleId: signupRoles.teamAdmin,
      });
      console.log(`✅ Created OTL for ${customerEmail}`);
    } catch (otlError) {
      console.error("❌ WARNING: Failed to create OTL (non-fatal):", otlError);
    }

    // Update Stripe customer with hosted.ai team ID
    const updatedCustomer = await stripe.customers.update(stripeCustomer.id, {
      metadata: {
        hostedai_team_id: team.id,
        billing_type: "free",
        free_tokens_limit: FREE_TRIAL_TOKENS.toString(),
        ...(gpu ? { signup_gpu: gpu } : {}),
        ...(plan ? { signup_plan: plan } : {}),
      },
    });
    cacheCustomer(updatedCustomer as import("stripe").default.Customer).catch(() => {});

    // Generate API key for Token Factory
    const { key, keyHash, keyPrefix } = generateApiKey();

    // Store API key with actual team ID
    await prisma.apiKey.create({
      data: {
        name: "Default API Key",
        keyPrefix,
        keyHash,
        stripeCustomerId: stripeCustomer.id,
        teamId: team.id, // Use real team ID
        scopes: "*",
      },
    });
    console.log(`✅ Created API key for ${customerEmail}`);

    // Generate dashboard URL with token
    const token = generateCustomerToken(customerEmail, stripeCustomer.id);
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

    // Send welcome email with API key (personalized for GPU visitors)
    try {
      await sendWelcomeAccountEmail({
        to: customerEmail,
        customerName,
        dashboardUrl,
        apiKey: key,
        gpu: gpu || undefined,
      });
      console.log(`✅ Sent welcome email to ${customerEmail}`);
    } catch (emailError) {
      console.error("❌ WARNING: Failed to send welcome email (non-fatal):", emailError);
    }

    // Create CustomerLifecycle record (marketing attribution + milestone tracking)
    try {
      await prisma.customerLifecycle.create({
        data: {
          stripeCustomerId: stripeCustomer.id,
          email: customerEmail,
          signedUpAt: new Date(),
          currentBillingType: "free",
          // Attribution
          utmSource: utm?.utm_source ? String(utm.utm_source).slice(0, 200) : null,
          utmMedium: utm?.utm_medium ? String(utm.utm_medium).slice(0, 200) : null,
          utmCampaign: utm?.utm_campaign ? String(utm.utm_campaign).slice(0, 200) : null,
          utmContent: utm?.utm_content ? String(utm.utm_content).slice(0, 200) : null,
          utmTerm: utm?.utm_term ? String(utm.utm_term).slice(0, 200) : null,
          landingPage: utm?.landing_page ? String(utm.landing_page).slice(0, 500) : null,
          referrer: utm?.referrer ? String(utm.referrer).slice(0, 500) : null,
          sessionId: sessionId ? String(sessionId).slice(0, 64) : null,
        },
      });
      // Link PageView records from this session to the customer
      if (sessionId) {
        await prisma.pageView.updateMany({
          where: { sessionId: String(sessionId) },
          data: { convertedCustomerId: stripeCustomer.id },
        });
      }
      console.log(`✅ Created CustomerLifecycle for ${customerEmail}`);
    } catch (lifecycleError) {
      console.error("⚠️ Failed to create CustomerLifecycle (non-fatal):", lifecycleError);
    }

    // Enroll in free signup drip campaign
    try {
      const dripSequence = await prisma.dripSequence.findFirst({
        where: { trigger: "signup-free", active: true },
      });
      if (dripSequence) {
        await prisma.dripEnrollment.create({
          data: {
            sequenceId: dripSequence.id,
            stripeCustomerId: stripeCustomer.id,
            email: customerEmail,
            customerName,
            metadata: JSON.stringify({ gpu: gpu || null, plan: plan || null }),
          },
        });
        console.log(`✅ Enrolled ${customerEmail} in drip sequence: ${dripSequence.slug}`);
      }
    } catch (dripError) {
      console.error("⚠️ Failed to enroll in drip campaign (non-fatal):", dripError);
    }

    // Log activity events
    logAccountCreated(stripeCustomer.id, customerEmail, gpu ? `free-gpu-${gpu}` : "free").catch(() => {});
    logApiKeyCreated(stripeCustomer.id, "Default API Key").catch(() => {});

    // Sync to Pipedrive (async, don't block response — Pro only)
    const gpuDisplayName = gpu ? (GPU_DISPLAY_NAMES[gpu] || gpu.toUpperCase()) : "";
    if (isPro()) {
      import("@/lib/pipedrive").then(({ syncCustomerToPipedrive }) =>
        syncCustomerToPipedrive({
          name: customerName,
          email: customerEmail,
          productName: gpu ? `Free Signup (${gpuDisplayName})` : "Free Signup",
          billingType: "free",
          stripeCustomerId: stripeCustomer.id,
        })
      ).catch((err) => console.error("[Pipedrive] Customer sync failed:", err));
    }

    console.log(`=== FREE SIGNUP COMPLETE: ${customerEmail} ===`);

    // Notify onboarding system
    sendOnboardingEvent({
      type: "user.signup",
      email: customerEmail,
      name: customerName,
      metadata: {
        "Stripe Customer ID": stripeCustomer.id,
        "Team ID": team?.id || "unknown",
        "Billing Type": "free_trial",
        "Free Tokens": FREE_TRIAL_TOKENS,
        "GPU Interest": gpu ? (GPU_DISPLAY_NAMES[gpu] || gpu.toUpperCase()) : "None",
        "Plan": plan || "None",
        "UTM Source": utm?.source || null,
        "UTM Medium": utm?.medium || null,
        "UTM Campaign": utm?.campaign || null,
        "Session ID": sessionId || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Account created! Check your email for your dashboard link and API key.",
      redirect: `${process.env.NEXT_PUBLIC_APP_URL}/success?type=free&email=${encodeURIComponent(customerEmail)}`,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
