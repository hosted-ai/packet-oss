import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

const MONTHLY_VOUCHER_LIMIT = 5; // Max 5 vouchers per email per month

function generateVoucherCode(): string {
  // Generate a readable voucher code: GAME-XXXX-XXXX
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars like O/0, I/1
  let code = "GAME-";
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getVoucherEmailHtml(voucherCode: string, creditCents: number, expiresAt: Date): string {
  const creditDollars = (creditCents / 100).toFixed(2);
  const expiresDate = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 500px; background: linear-gradient(180deg, #1a1a2e 0%, #0f0f18 100%); border-radius: 16px; border: 1px solid #2a2a4a; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2a2a4a;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #fff;">🎮 GPU TETRIS WINNER!</h1>
              <p style="margin: 12px 0 0; color: #888; font-size: 14px;">Congratulations on optimizing your GPUs!</p>
            </td>
          </tr>

          <!-- Voucher Code -->
          <tr>
            <td style="padding: 32px;">
              <div style="background: rgba(34, 197, 94, 0.1); border: 2px solid #22c55e; border-radius: 12px; padding: 24px; text-align: center;">
                <p style="margin: 0 0 12px; color: #22c55e; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Your Voucher Code</p>
                <p style="margin: 0; font-size: 32px; font-weight: 900; font-family: monospace; color: #feca57; letter-spacing: 2px;">${voucherCode}</p>
              </div>

              <div style="margin-top: 24px; text-align: center;">
                <p style="margin: 0 0 8px; color: #64ffda; font-size: 24px; font-weight: 700;">$${creditDollars} GPU Credits</p>
                <p style="margin: 0; color: #888; font-size: 14px;">≈ 1 hour of RTX PRO 6000 compute time</p>
              </div>
            </td>
          </tr>

          <!-- How to Use -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <div style="background: #0a0a0f; border-radius: 8px; padding: 20px;">
                <p style="margin: 0 0 12px; color: #fff; font-weight: 600;">How to use your voucher:</p>
                <ol style="margin: 0; padding-left: 20px; color: #aaa; font-size: 14px; line-height: 1.8;">
                  <li>Sign up at <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout" style="color: #64ffda;">Sign up here</a></li>
                  <li>Enter your voucher code at checkout</li>
                  <li>Or add it in Dashboard → Billing → Add Voucher</li>
                </ol>
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #e94560, #ff6b6b); color: #fff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 16px;">Start Using GPUs →</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #2a2a4a; text-align: center;">
              <p style="margin: 0 0 8px; color: #666; font-size: 12px;">Expires: ${expiresDate}</p>
              <p style="margin: 0; color: #666; font-size: 12px;">Questions? Reply to this email or contact support@example.com</p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; color: #444; font-size: 12px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}" style="color: #666;">GPU Cloud</a> - GPU Infrastructure for AI
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function getVoucherEmailText(voucherCode: string, creditCents: number, expiresAt: Date): string {
  const creditDollars = (creditCents / 100).toFixed(2);
  const expiresDate = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
🎮 GPU TETRIS WINNER!

Congratulations on optimizing your GPUs!

YOUR VOUCHER CODE: ${voucherCode}

Value: $${creditDollars} GPU Credits (≈ 1 hour of RTX PRO 6000 compute time)

HOW TO USE:
1. Sign up at ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout
2. Enter your voucher code at checkout
3. Or add it in Dashboard → Billing → Add Voucher

Expires: ${expiresDate}

Questions? Contact support@example.com

---
GPU Infrastructure for AI
`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, score } = body;

    // Validate email
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { success: false, error: "Invalid email address" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate game completion - based on utilization (75% threshold)
    const WIN_THRESHOLD = 75;
    const utilization = body.utilization ?? body.avgUtilization;
    if (typeof utilization !== "number" || utilization < WIN_THRESHOLD) {
      return NextResponse.json(
        { success: false, error: `You must reach ${WIN_THRESHOLD}%+ average utilization to win` },
        { status: 400 }
      );
    }

    // Check monthly voucher limit (database-based, persistent)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyVoucherCount = await prisma.voucher.count({
      where: {
        code: { startsWith: "GAME-" },
        description: { contains: normalizedEmail },
        createdAt: { gte: startOfMonth },
      },
    });

    if (monthlyVoucherCount >= MONTHLY_VOUCHER_LIMIT) {
      return NextResponse.json(
        { success: false, error: `You've reached the limit of ${MONTHLY_VOUCHER_LIMIT} vouchers this month. Try again next month!` },
        { status: 429 }
      );
    }

    // Generate unique voucher code
    let voucherCode = generateVoucherCode();
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const existing = await prisma.voucher.findUnique({
        where: { code: voucherCode },
      });
      if (!existing) break;
      voucherCode = generateVoucherCode();
      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.error("Failed to generate unique voucher code");
      return NextResponse.json(
        { success: false, error: "Failed to generate voucher. Please try again." },
        { status: 500 }
      );
    }

    // RTX PRO 6000 Blackwell hourly rate is around $1.29/hour, so 1 hour = $1.29 = 129 cents
    // We'll give a $1.50 credit to be generous (150 cents)
    const CREDIT_CENTS = 150;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Create the voucher
    const voucher = await prisma.voucher.create({
      data: {
        code: voucherCode,
        name: "GPU Tetris Winner - 1 Hour RTX PRO 6000",
        description: `Won by ${normalizedEmail} with score ${score}, ${utilization}% avg utilization`,
        creditCents: CREDIT_CENTS,
        minTopupCents: null,
        maxRedemptions: 1,
        maxPerCustomer: 1,
        startsAt: null,
        expiresAt,
        active: true,
        createdBy: "game-voucher",
      },
    });

    // Send voucher email
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: `🎮 Your GPU Tetris Voucher: ${voucherCode}`,
        html: getVoucherEmailHtml(voucherCode, CREDIT_CENTS, expiresAt),
        text: getVoucherEmailText(voucherCode, CREDIT_CENTS, expiresAt),
      });
      console.log(`[Game Voucher] Email sent to ${normalizedEmail}`);
    } catch (emailError) {
      // Don't fail the request if email fails - user still sees the code on screen
      console.error(`[Game Voucher] Failed to send email to ${normalizedEmail}:`, emailError);
    }

    // Log the voucher creation
    console.log(
      `[Game Voucher] Created ${voucherCode} for ${normalizedEmail} - Score: ${score}, Util: ${utilization}% (${monthlyVoucherCount + 1}/${MONTHLY_VOUCHER_LIMIT} this month)`
    );

    return NextResponse.json({
      success: true,
      voucherCode: voucher.code,
      creditCents: voucher.creditCents,
      expiresAt: voucher.expiresAt,
      monthlyCount: monthlyVoucherCount + 1,
      monthlyLimit: MONTHLY_VOUCHER_LIMIT,
    });
  } catch (error) {
    console.error("Failed to create game voucher:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate voucher. Please try again." },
      { status: 500 }
    );
  }
}

// GET - Check if email has already claimed a voucher
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email) {
    return NextResponse.json(
      { success: false, error: "Email required" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Check monthly voucher count
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyVoucherCount = await prisma.voucher.count({
      where: {
        code: { startsWith: "GAME-" },
        description: { contains: normalizedEmail },
        createdAt: { gte: startOfMonth },
      },
    });

    // Get most recent voucher
    const existingVoucher = await prisma.voucher.findFirst({
      where: {
        code: { startsWith: "GAME-" },
        description: { contains: normalizedEmail },
      },
      orderBy: { createdAt: "desc" },
      select: {
        code: true,
        createdAt: true,
        redemptionCount: true,
      },
    });

    return NextResponse.json({
      success: true,
      hasVoucher: !!existingVoucher,
      voucher: existingVoucher ? {
        code: existingVoucher.code,
        redeemed: existingVoucher.redemptionCount > 0,
        createdAt: existingVoucher.createdAt,
      } : null,
      monthlyCount: monthlyVoucherCount,
      monthlyLimit: MONTHLY_VOUCHER_LIMIT,
      canClaimMore: monthlyVoucherCount < MONTHLY_VOUCHER_LIMIT,
    });
  } catch (error) {
    console.error("Failed to check voucher:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check voucher status" },
      { status: 500 }
    );
  }
}
