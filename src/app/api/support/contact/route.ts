import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { prisma } from "@/lib/prisma";
import { sendContactEmail } from "@/lib/email/templates/contact";

/**
 * POST /api/support/contact
 *
 * OSS contact form submission. Creates a ContactSubmission record
 * and sends an email notification to the support address.
 */
export async function POST(request: NextRequest) {
  const authResult = await getAuthenticatedCustomer(request);
  if (authResult instanceof NextResponse) return authResult;

  const customerId = authResult.payload.customerId;
  const customerEmail = authResult.payload.email;
  const customerName = (authResult.customer.name || authResult.payload.email.split("@")[0]);

  let body: { subject?: string; message?: string; priority?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { subject, message, priority } = body;

  // Validate required fields
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json(
      { success: false, error: "Message is required" },
      { status: 400 }
    );
  }

  // Validate lengths
  if (subject && subject.length > 200) {
    return NextResponse.json(
      { success: false, error: "Subject must be 200 characters or less" },
      { status: 400 }
    );
  }
  if (message.length > 10000) {
    return NextResponse.json(
      { success: false, error: "Message must be 10,000 characters or less" },
      { status: 400 }
    );
  }

  // Validate priority
  const validPriority =
    priority === "high" ? "high" : "normal";

  const name = customerName;
  const finalSubject = subject?.trim() || "Support Request";

  try {
    // Store in database
    const submission = await prisma.contactSubmission.create({
      data: {
        name,
        email: customerEmail,
        subject: finalSubject,
        message: message.trim(),
        priority: validPriority,
        stripeCustomerId: customerId,
      },
    });

    // Send email notification (non-blocking — don't fail the request if email fails)
    try {
      await sendContactEmail({
        name,
        email: customerEmail,
        subject: finalSubject,
        priority: validPriority,
        message: message.trim(),
      });
      console.log(
        `[Contact] Email sent to support for submission ${submission.id} from ${customerEmail}`
      );
    } catch (emailErr) {
      console.error(
        `[Contact] Email send failed for submission ${submission.id}:`,
        emailErr
      );
      // Don't fail the request — the submission is stored in DB
    }

    console.log(
      `[Contact] New submission ${submission.id} from ${customerEmail} — subject: ${finalSubject}`
    );

    return NextResponse.json({
      success: true,
      submission: {
        id: submission.id,
        subject: submission.subject,
        createdAt: submission.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[Contact] Failed to create submission:", err);
    return NextResponse.json(
      { success: false, error: "Failed to submit message" },
      { status: 500 }
    );
  }
}
