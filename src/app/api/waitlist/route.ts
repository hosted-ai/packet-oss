import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { syncWaitlistToPipedrive } from "@/lib/pipedrive";

const EMAILIT_API_KEY = process.env.EMAILIT_API_KEY;

export async function POST(request: NextRequest) {
  // Rate limit: 3 requests per minute per IP
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`waitlist:${ip}`, {
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
    const { email } = body;

    // Validate email
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    if (!EMAILIT_API_KEY) {
      console.error("EMAILIT_API_KEY is not set");
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 500 }
      );
    }

    // Send notification to sales team
    const response = await fetch("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EMAILIT_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "GPU Cloud <no-reply@example.com>",
        to: process.env.SALES_EMAIL || process.env.ADMIN_BCC_EMAIL || "sales@example.com",
        subject: `[GPU Cloud Waitlist] New signup: ${trimmedEmail}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #000; margin: 0; font-size: 24px;">New Waitlist Signup</h1>
              </div>

              <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 18px;"><strong>Email:</strong> <a href="mailto:${trimmedEmail}">${trimmedEmail}</a></p>
              </div>

              <p style="color: #666; font-size: 14px;">
                This person signed up for the GPU Cloud waitlist and is interested in B200 GPU access.
              </p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

              <p style="color: #999; font-size: 13px; text-align: center;">
                GPU Cloud Waitlist Notification
              </p>
            </body>
          </html>
        `,
        text: `New Waitlist Signup\n\nEmail: ${trimmedEmail}\n\nThis person signed up for the GPU Cloud waitlist and is interested in B200 GPU access.`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Emailit API error:", error);
      return NextResponse.json(
        { error: "Failed to join waitlist. Please try again." },
        { status: 500 }
      );
    }

    // Sync to Pipedrive CRM (don't fail if this fails)
    try {
      await syncWaitlistToPipedrive({ email: trimmedEmail });
    } catch (pipedriveError) {
      console.error("Pipedrive sync error:", pipedriveError);
      // Don't fail the request if Pipedrive sync fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Waitlist error:", error);
    return NextResponse.json(
      { error: "Failed to join waitlist. Please try again later." },
      { status: 500 }
    );
  }
}
