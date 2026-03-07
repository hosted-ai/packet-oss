/**
 * GET /api/drip/unsubscribe?token=xxx
 *
 * One-click unsubscribe from drip marketing emails.
 * Cancels all active drip enrollments for the email in the token.
 * Returns a simple HTML confirmation page.
 *
 * Does NOT affect transactional emails (billing, pod events, support).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/customer-auth";

function htmlPage(title: string, message: string, success: boolean) {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — GPU Cloud</title>
  <style>
    body { margin: 0; padding: 0; background: #f7f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; border: 1px solid #e4e7ef; max-width: 480px; width: 100%; padding: 40px; text-align: center; margin: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: #0b0f1c; margin: 0 0 8px 0; letter-spacing: -0.3px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    p { font-size: 15px; line-height: 1.6; color: #5b6476; margin: 0 0 16px 0; }
    .brand { font-size: 14px; color: #5b6476; margin-top: 24px; }
    .brand strong { color: #0b0f1c; }
    a { color: #1a4fff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "&#9989;" : "&#9888;&#65039;"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="brand"><strong>GPU Cloud</strong></p>
  </div>
</body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return htmlPage(
      "Invalid Link",
      "This unsubscribe link is missing a token. If you clicked a link from an email, try clicking it again or copying the full URL.",
      false
    );
  }

  const payload = verifyUnsubscribeToken(token);

  if (!payload) {
    return htmlPage(
      "Link Expired",
      "This unsubscribe link has expired. Don't worry — you can reply to any of our emails and ask to be removed, or contact <a href=\"mailto:support@example.com\">support@example.com</a>.",
      false
    );
  }

  const email = payload.email;

  try {
    // Cancel all active drip enrollments for this email
    // Email in the token is already lowercased by generateUnsubscribeToken
    const result = await prisma.dripEnrollment.updateMany({
      where: {
        email: email,
        status: "active",
      },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
      },
    });

    console.log(`[Drip] Unsubscribed ${email} — cancelled ${result.count} active enrollment(s)`);

    return htmlPage(
      "You've been unsubscribed",
      `<strong>${email}</strong> has been removed from our onboarding emails. You'll still receive important account emails like billing receipts and pod notifications.`,
      true
    );
  } catch (err) {
    console.error(`[Drip] Unsubscribe error for ${email}:`, err);
    return htmlPage(
      "Something went wrong",
      "We couldn't process your unsubscribe request. Please try again or contact <a href=\"mailto:support@example.com\">support@example.com</a>.",
      false
    );
  }
}
