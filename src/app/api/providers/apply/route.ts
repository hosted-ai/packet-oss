import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createProviderApplication, getProviderByEmail } from "@/lib/auth/provider";
import {
  sendProviderApplicationReceivedEmail,
  sendAdminNewProviderAlert,
} from "@/lib/email/templates/provider";
import { rateLimit } from "@/lib/ratelimit";

const applySchema = z.object({
  applicationType: z.enum(["gpu_provider", "white_label"]).default("gpu_provider"),
  email: z.string().email(),
  companyName: z.string().min(2).max(200),
  contactName: z.string().min(2).max(100),
  phone: z.string().optional(),
  website: z.string().url(),
  // GPU provider fields
  estimatedGpuCount: z.number().int().positive().optional(),
  gpuTypes: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  // Contact points
  supportEmail: z.string().email().optional().or(z.literal("")),
  commercialEmail: z.string().email().optional().or(z.literal("")),
  // White label fields
  desiredDomain: z.string().max(200).optional(),
  expectedCustomers: z.string().max(200).optional(),
  additionalInfo: z.string().max(2000).optional(),
});

/**
 * POST /api/providers/apply
 * Submit a new provider application
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit: 3 applications per hour per IP
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const rateLimitResult = rateLimit(`provider-apply:${ip}`, { maxRequests: 3, windowMs: 60 * 60 * 1000 });
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Too many applications. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = applySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid application data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Check if email already exists
    const existingProvider = await getProviderByEmail(data.email);
    if (existingProvider) {
      // Don't reveal that email exists
      return NextResponse.json({
        success: true,
        message: "Application submitted successfully. Check your email for next steps.",
      });
    }

    // Create the provider application
    const provider = await prisma.serviceProvider.create({
      data: {
        applicationType: data.applicationType,
        email: data.email.toLowerCase(),
        companyName: data.companyName,
        contactName: data.contactName,
        phone: data.phone || null,
        website: data.website || null,
        estimatedGpuCount: data.estimatedGpuCount || null,
        gpuTypes: data.gpuTypes ? JSON.stringify(data.gpuTypes) : null,
        regions: data.regions ? JSON.stringify(data.regions) : null,
        supportEmail: data.supportEmail || null,
        commercialEmail: data.commercialEmail || null,
        generalEmail: data.email.toLowerCase(), // Default to primary email
        desiredDomain: data.desiredDomain || null,
        expectedCustomers: data.expectedCustomers || null,
        status: "pending",
      },
    });

    // Send emails (non-blocking — don't fail the application if emails fail)
    try {
      await sendProviderApplicationReceivedEmail({
        to: data.email,
        companyName: data.companyName,
        contactName: data.contactName,
        applicationType: data.applicationType,
      });
    } catch (e) {
      console.error("Failed to send provider confirmation email:", e);
    }

    try {
      await sendAdminNewProviderAlert({
        providerId: provider.id,
        companyName: data.companyName,
        contactName: data.contactName,
        email: data.email,
        estimatedGpuCount: data.estimatedGpuCount,
        gpuTypes: data.gpuTypes,
        applicationType: data.applicationType,
        desiredDomain: data.desiredDomain,
        expectedCustomers: data.expectedCustomers,
        additionalInfo: data.additionalInfo,
      });
    } catch (e) {
      console.error("Failed to send admin alert:", e);
    }

    // Record notification
    try {
      await prisma.providerNotification.create({
        data: {
          providerId: provider.id,
          type: "welcome",
          subject: "Welcome to GPU Cloud - Application Received",
        },
      });
    } catch (e) {
      console.error("Failed to record notification:", e);
    }

    return NextResponse.json({
      success: true,
      message: "Application submitted successfully. Check your email for next steps.",
    });
  } catch (error) {
    console.error("Provider application error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to submit application" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/providers/apply
 * Get allowed GPU types for the application form
 */
export async function GET() {
  try {
    const gpuTypes = await prisma.allowedGpuType.findMany({
      where: { acceptingSubmissions: true },
      orderBy: { displayOrder: "asc" },
      select: {
        name: true,
        shortName: true,
        manufacturer: true,
        defaultProviderRateCents: true,
        defaultCustomerRateCents: true,
        defaultTermsType: true,
        defaultRevenueSharePercent: true,
      },
    });

    // Format rates for display
    const formattedGpuTypes = gpuTypes.map((gpu) => ({
      name: gpu.name,
      shortName: gpu.shortName,
      manufacturer: gpu.manufacturer,
      providerRate: `$${(gpu.defaultProviderRateCents / 100).toFixed(2)}/hr`,
      customerRate: `$${(gpu.defaultCustomerRateCents / 100).toFixed(2)}/hr`,
      termsType: gpu.defaultTermsType,
      revenueSharePercent: gpu.defaultRevenueSharePercent,
    }));

    // Also return available regions
    const regions = [
      { id: "us-east", name: "US East" },
      { id: "us-west", name: "US West" },
      { id: "eu-west", name: "Europe West" },
      { id: "eu-central", name: "Europe Central" },
      { id: "asia-east", name: "Asia East" },
      { id: "asia-south", name: "Asia South" },
    ];

    return NextResponse.json({
      success: true,
      data: {
        gpuTypes: formattedGpuTypes,
        regions,
      },
    });
  } catch (error) {
    console.error("Failed to get GPU types:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get GPU types" },
      { status: 500 }
    );
  }
}
