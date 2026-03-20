import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { logLoginLinkSent } from "@/lib/admin-activity";
import {
  createTeam,
  getDefaultPolicies,
  getRoles,
} from "@/lib/hostedai";
import { getBrandName } from "@/lib/branding";
import { sendLoginEmailForCustomer } from "@/lib/customer-login-email";
import crypto from "crypto";

function generateSecurePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function POST(request: NextRequest) {
  // Rate limit: 5 requests per minute per IP (stricter for email lookups)
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`account:${ip}`, {
    maxRequests: 5,
    windowMs: 60000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const normalizedEmail = email.toLowerCase();

    // ── Team auto-provisioning (login-specific) ──────────────────────────
    // If a paid customer has no hosted.ai team (e.g., team creation failed
    // during signup but user already topped up), provision one now before
    // sending the login email.
    const customers = await stripe.customers.list({
      email: normalizedEmail,
      limit: 10,
    });

    console.log(`[Account] Email lookup: ${email}, found ${customers.data.length} customers`);

    if (customers.data.length > 0) {
      const customer =
        customers.data.find(c => c.metadata?.hostedai_team_id && c.metadata?.billing_type === "hourly") ||
        customers.data.find(c => c.metadata?.hostedai_team_id && ["free", "free_trial"].includes(c.metadata?.billing_type || "")) ||
        customers.data.find(c => c.metadata?.hostedai_team_id) ||
        customers.data[0];

      const teamId = customer.metadata?.hostedai_team_id;
      const billingType = customer.metadata?.billing_type;

      // Auto-provision team for paid customers who don't have one yet
      if (!teamId && billingType && billingType !== "free" && billingType !== "free_trial") {
        const customerEmail = customer.email || normalizedEmail;
        const customerName = customer.name || customerEmail.split("@")[0];
        console.log(`[Account] Customer ${customer.id} is ${billingType} but has no team — provisioning now`);

        try {
          const generatedPassword = generateSecurePassword();
          const teamName = `${customerName}-${billingType}-${Date.now()}`;
          const [roles, policies] = await Promise.all([getRoles(), getDefaultPolicies()]);
          const team = await createTeam({
            name: teamName,
            description: `${getBrandName()} - ${billingType} (auto-provisioned on login)`,
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
          console.log(`[Account] Created hosted.ai team ${team.id} for ${customer.id}`);

          await stripe.customers.update(customer.id, {
            metadata: {
              ...customer.metadata,
              hostedai_team_id: team.id,
            },
          });
        } catch (teamError) {
          console.error(`[Account] Failed to provision team for ${customer.id}:`, teamError);
          // Continue — still send login email even if team creation fails
        }
      }
    }

    // ── Send login email via shared function ─────────────────────────────
    // Handles all account types: paid, free trial, team member.
    // Returns true if an email was sent, false if no account found.
    const emailSent = await sendLoginEmailForCustomer(normalizedEmail);

    if (!emailSent) {
      // No account found — log the attempt for admin visibility
      logLoginLinkSent(normalizedEmail, false).catch(() => {});
    }

    // Always return identical response (anti-enumeration)
    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, you will receive access links shortly.",
    });
  } catch (error) {
    console.error("Account lookup error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
