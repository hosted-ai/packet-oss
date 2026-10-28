import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";
import { cacheCustomer } from "@/lib/customer-cache";
import { prisma } from "@/lib/prisma";
import { getEmbargoedCountryCodes } from "@/lib/embargo";
import type Stripe from "stripe";

// Profile = the Stripe customer (name/email/phone + light metadata) PLUS the
// KYC / billing fields on CustomerSettings (legal/finance mandate for bare
// metal). BOTH sides key on auth.accountId (the operating account) — PA-231
// was a read/write mismatch where GET read the operating account but PUT wrote
// payload.customerId, so saves silently hit the wrong record for team members.
//
// company now lives in CustomerSettings.companyName; we fall back to the legacy
// customer.metadata.company on read so un-migrated rows still show their value.

const KYC_SELECT = {
  personalAddress: true,
  country: true,
  zipCode: true,
  companyName: true,
  companyAddress: true,
  companyRegNumber: true,
  companyCountry: true,
  companyZipCode: true,
  companyWebsite: true,
} as const;

type KycSettings = {
  personalAddress: string | null;
  country: string | null;
  zipCode: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyRegNumber: string | null;
  companyCountry: string | null;
  companyZipCode: string | null;
  companyWebsite: string | null;
} | null;

// includeKyc=false redacts the billing/KYC fields — a team member without
// billing.view still sees their basic profile, but not the company's
// legal/billing identity (which only billing managers may read/edit).
function profileShape(customer: Stripe.Customer, settings: KycSettings, includeKyc: boolean) {
  const base = {
    name: customer.name || "",
    email: customer.email || "",
    phone: customer.phone || "",
    jobTitle: customer.metadata?.job_title || "",
    website: customer.metadata?.website || "",
    timezone: customer.metadata?.timezone || "",
    useCase: customer.metadata?.use_case || "",
  };
  if (!includeKyc) {
    return {
      ...base,
      company: "",
      personalAddress: "",
      country: "",
      zipCode: "",
      companyAddress: "",
      companyRegNumber: "",
      companyCountry: "",
      companyZipCode: "",
      companyWebsite: "",
    };
  }
  return {
    ...base,
    // KYC (CustomerSettings); company falls back to legacy metadata pre-migration.
    company: settings?.companyName || customer.metadata?.company || "",
    personalAddress: settings?.personalAddress || "",
    country: settings?.country || "",
    zipCode: settings?.zipCode || "",
    companyAddress: settings?.companyAddress || "",
    companyRegNumber: settings?.companyRegNumber || "",
    companyCountry: settings?.companyCountry || "",
    companyZipCode: settings?.companyZipCode || "",
    companyWebsite: settings?.companyWebsite || "",
  };
}

// GET /api/account/profile - Get customer profile
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;
  const { customer, accountId } = auth;
  // KYC/billing fields are gated to billing.view; everyone may read their own
  // basic profile (name/email/phone). Members without billing.view get KYC redacted.
  const includeKyc = auth.can("billing.view");

  try {
    const settings = includeKyc
      ? ((await prisma.customerSettings
          .findUnique({ where: { stripeCustomerId: accountId }, select: KYC_SELECT })
          .catch(() => null)) as KycSettings)
      : null;
    return NextResponse.json({
      success: true,
      profile: profileShape(customer, settings, includeKyc),
      // Live embargo set so the billing country dropdown eliminates the same
      // jurisdictions the server-side gate blocks (empty when embargo disabled).
      embargoedCountries: await getEmbargoedCountryCodes(),
    });
  } catch (error) {
    console.error("Failed to get profile:", error);
    return NextResponse.json({ error: "Failed to get profile" }, { status: 500 });
  }
}

// PUT /api/account/profile - Update customer profile
export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;
  // The profile is the operating account's billing/KYC identity (company name,
  // addresses, reg number — legal/finance data). Only billing managers (Team
  // Admins / Finance) may edit it; a regular member must not alter the
  // company's identity. (RBAC fix: PA-231 moved writes to the operating account.)
  const denial = requirePermission(auth, "billing.manage", request);
  if (denial) return denial;
  const { stripe, accountId } = auth;

  try {
    const body = await request.json();
    const {
      name,
      company,
      phone,
      jobTitle,
      website,
      timezone,
      useCase,
      personalAddress,
      country,
      zipCode,
      companyAddress,
      companyRegNumber,
      companyCountry,
      companyZipCode,
      companyWebsite,
    } = body;

    // PA-231: write the OPERATING ACCOUNT (accountId), not payload.customerId.
    // company moved to CustomerSettings, so it's no longer a Stripe metadata key.
    const updatedCustomer = await stripe.customers.update(accountId, {
      name: name || undefined,
      phone: phone || undefined,
      metadata: {
        job_title: jobTitle || "",
        website: website || "",
        timezone: timezone || "",
        use_case: useCase || "",
      },
    });
    cacheCustomer(updatedCustomer as Stripe.Customer).catch(() => {});

    // KYC + company persist on CustomerSettings, keyed on the operating account.
    // `?? undefined` so an omitted field is left unchanged; an explicit "" clears it.
    const kyc = {
      companyName: company ?? undefined,
      personalAddress: personalAddress ?? undefined,
      country: country ?? undefined,
      zipCode: zipCode ?? undefined,
      companyAddress: companyAddress ?? undefined,
      companyRegNumber: companyRegNumber ?? undefined,
      companyCountry: companyCountry ?? undefined,
      companyZipCode: companyZipCode ?? undefined,
      companyWebsite: companyWebsite ?? undefined,
    };
    const settings = (await prisma.customerSettings.upsert({
      where: { stripeCustomerId: accountId },
      update: kyc,
      create: { stripeCustomerId: accountId, ...kyc },
      select: KYC_SELECT,
    })) as KycSettings;

    return NextResponse.json({
      success: true,
      profile: profileShape(updatedCustomer as Stripe.Customer, settings, true),
    });
  } catch (error) {
    console.error("Failed to update profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
