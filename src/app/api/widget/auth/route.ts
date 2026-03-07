import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { generateCustomerToken } from '@/lib/customer-auth';
import { sendEmail } from '@/lib/email';
import {
  emailLayout, emailButton, emailGreeting, emailText, emailMuted, emailSignoff,
} from '@/lib/email/utils';
import { getEmailBranding } from '@/lib/email/tenant-branding';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { cacheCustomer } from '@/lib/customer-cache';
import type Stripe from 'stripe';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-tenant-host',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  // Rate limit: 5 requests per IP per minute
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`widget-auth:${ip}`, {
    maxRequests: 5,
    windowMs: 60000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: CORS_HEADERS }
    );
  }

  try {
    const body = await request.json();
    const email = body?.email;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = email.toLowerCase().trim();

    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'GPU Cloud';

    // Get the Stripe instance
    const stripe = getStripe();

    // Look up existing customers by email — find the primary one (hourly/wallet)
    const customers = await stripe.customers.list({
      email: normalizedEmail,
      limit: 10,
    });

    let customerId: string;
    let customerName: string;

    if (customers.data.length > 0) {
      // Find the best customer: prefer hourly/wallet customer with team
      const bestCustomer =
        customers.data.find(c => c.metadata?.hostedai_team_id && c.metadata?.billing_type === "hourly") ||
        customers.data.find(c => c.metadata?.hostedai_team_id) ||
        customers.data[0];
      customerId = bestCustomer.id;
      customerName = bestCustomer.name || normalizedEmail.split('@')[0];
    } else {
      // Create a new customer in the tenant's Stripe account
      const name = normalizedEmail.split('@')[0].replace(/[^a-zA-Z0-9\- ]/g, '').trim() || 'User';
      const newCustomer = await stripe.customers.create({
        email: normalizedEmail,
        name,
        metadata: {
          source: 'widget',
        },
      });
      cacheCustomer(newCustomer as Stripe.Customer).catch(() => {});
      customerId = newCustomer.id;
      customerName = name;
    }

    // Generate magic link JWT token (1 hour expiry)
    const token = generateCustomerToken(normalizedEmail, customerId, 1);

    // Determine dashboard URL
    const emailBranding = getEmailBranding();
    const dashboardUrl = emailBranding.dashboardUrl;
    const loginUrl = `${dashboardUrl}/account/verify?token=${token}`;

    // Send magic link email
    await sendEmail({
      to: normalizedEmail,
      subject: `Your ${brandName} login link`,
      html: emailLayout({
        preheader: `Your login link for ${brandName}`,
        body: `
          ${emailGreeting(customerName)}
          ${emailText(`Here is your login link for ${brandName}:`)}
          ${emailButton('Open Dashboard', loginUrl, emailBranding)}
          ${emailMuted('This link expires in 1 hour. If you did not request this, you can safely ignore this email.')}
          ${emailSignoff(emailBranding)}
        `,
        branding: emailBranding,
      }),
      text: `Hi ${customerName},

Here is your login link for ${brandName}:

Open Dashboard: ${loginUrl}

This link expires in 1 hour. If you did not request this, you can safely ignore this email.

The ${brandName} Team

---
${brandName} by Hosted AI Inc.
622 North 9th Street, San Jose, CA 95112, USA
This is a transactional email related to your ${brandName} account.`,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Check your email for a login link',
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('[Widget Auth] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
