import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { cacheCustomer } from "@/lib/customer-cache";
import type Stripe from "stripe";

// GET /api/account/profile - Get customer profile
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;
  const { customer } = auth;

  try {
    return NextResponse.json({
      success: true,
      profile: {
        name: customer.name || "",
        email: customer.email || "",
        company: customer.metadata?.company || "",
        phone: customer.phone || "",
        jobTitle: customer.metadata?.job_title || "",
        website: customer.metadata?.website || "",
        timezone: customer.metadata?.timezone || "",
        useCase: customer.metadata?.use_case || "",
      },
    });
  } catch (error) {
    console.error("Failed to get profile:", error);
    return NextResponse.json(
      { error: "Failed to get profile" },
      { status: 500 }
    );
  }
}

// PUT /api/account/profile - Update customer profile
export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;
  const { payload, stripe } = auth;

  try {
    const body = await request.json();
    const { name, company, phone, jobTitle, website, timezone, useCase } = body;

    // Update customer in Stripe
    const updatedCustomer = await stripe.customers.update(payload.customerId, {
      name: name || undefined,
      phone: phone || undefined,
      metadata: {
        company: company || "",
        job_title: jobTitle || "",
        website: website || "",
        timezone: timezone || "",
        use_case: useCase || "",
      },
    });
    cacheCustomer(updatedCustomer as Stripe.Customer).catch(() => {});

    return NextResponse.json({
      success: true,
      profile: {
        name: updatedCustomer.name || "",
        email: updatedCustomer.email || "",
        company: updatedCustomer.metadata?.company || "",
        phone: updatedCustomer.phone || "",
        jobTitle: updatedCustomer.metadata?.job_title || "",
        website: updatedCustomer.metadata?.website || "",
        timezone: updatedCustomer.metadata?.timezone || "",
        useCase: updatedCustomer.metadata?.use_case || "",
      },
    });
  } catch (error) {
    console.error("Failed to update profile:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
