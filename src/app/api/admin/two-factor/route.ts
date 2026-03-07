import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getTwoFactorStatus,
  startTwoFactorSetup,
  completeTwoFactorSetup,
  disableTwoFactor,
  regenerateBackupCodes,
  verifyTwoFactorCode,
} from "@/lib/two-factor";

/**
 * GET /api/admin/two-factor
 * Get 2FA status for the authenticated admin
 */
export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = await getTwoFactorStatus(session.email);

    return NextResponse.json({
      enabled: status.enabled,
      hasBackupCodes: status.hasBackupCodes,
    });
  } catch (error) {
    console.error("Admin 2FA status error:", error);
    return NextResponse.json(
      { error: "Failed to get 2FA status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/two-factor
 * Manage 2FA: setup, confirm, disable, regenerate backup codes, or verify
 *
 * Body:
 * - action: "setup" | "confirm" | "disable" | "regenerate-backup-codes" | "verify"
 * - code: TOTP code (required for confirm, disable, verify)
 */
export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, code } = body;

    switch (action) {
      case "setup": {
        const setupData = await startTwoFactorSetup(session.email);
        return NextResponse.json({
          qrCode: setupData.qrCode,
          secret: setupData.secret,
          backupCodes: setupData.backupCodes,
          message: "Scan the QR code with your authenticator app, then enter a code to confirm.",
        });
      }

      case "confirm": {
        if (!code) {
          return NextResponse.json(
            { error: "Code is required" },
            { status: 400 }
          );
        }

        const result = await completeTwoFactorSetup(session.email, code);
        if (!result.success) {
          return NextResponse.json(
            { error: result.error },
            { status: 400 }
          );
        }

        return NextResponse.json({
          success: true,
          message: "Two-factor authentication enabled successfully!",
        });
      }

      case "disable": {
        if (!code) {
          return NextResponse.json(
            { error: "Code is required to disable 2FA" },
            { status: 400 }
          );
        }

        const verifyResult = await verifyTwoFactorCode(session.email, code);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: "Invalid code" },
            { status: 400 }
          );
        }

        await disableTwoFactor(session.email);
        return NextResponse.json({
          success: true,
          message: "Two-factor authentication disabled.",
        });
      }

      case "regenerate-backup-codes": {
        if (!code) {
          return NextResponse.json(
            { error: "Code is required to regenerate backup codes" },
            { status: 400 }
          );
        }

        const verifyResult = await verifyTwoFactorCode(session.email, code);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: "Invalid code" },
            { status: 400 }
          );
        }

        const newCodes = await regenerateBackupCodes(session.email);
        if (!newCodes) {
          return NextResponse.json(
            { error: "2FA not enabled" },
            { status: 400 }
          );
        }

        return NextResponse.json({
          backupCodes: newCodes,
          message: "New backup codes generated. Save these securely!",
        });
      }

      case "verify": {
        if (!code) {
          return NextResponse.json(
            { error: "Code is required" },
            { status: 400 }
          );
        }

        const verifyResult = await verifyTwoFactorCode(session.email, code);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: verifyResult.error },
            { status: 400 }
          );
        }

        return NextResponse.json({
          success: true,
          usedBackupCode: verifyResult.usedBackupCode,
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Admin 2FA action error:", error);
    return NextResponse.json(
      { error: "Failed to process 2FA action" },
      { status: 500 }
    );
  }
}
