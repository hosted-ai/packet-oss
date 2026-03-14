import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendContactEmail } from "@/lib/email";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { isPro } from "@/lib/edition";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Name is required (at least 2 characters)").max(200),
  email: z.string().trim().email("Valid email is required").max(320),
  company: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10, "Message is required (at least 10 characters)").max(10000),
});

export async function POST(request: NextRequest) {
  // Rate limit: 3 requests per minute per IP
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`contact:${ip}`, {
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
    const body = await request.json();
    const parsed = contactSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { name, email, company, message } = parsed.data;

    // Send the email (values already trimmed by Zod schema)
    await sendContactEmail({
      name,
      email,
      company: company || undefined,
      message,
    });

    // Sync lead to Pipedrive (async, don't block response — Pro only)
    if (isPro()) {
      import("@/lib/pipedrive").then(({ syncContactLeadToPipedrive }) =>
        syncContactLeadToPipedrive({
          name,
          email: email.toLowerCase(),
          company,
          message,
        })
      ).catch((err) => console.error("[Pipedrive] Contact sync failed:", err));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 500 }
    );
  }
}
