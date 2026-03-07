import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import {
  getTwoFactorStatus,
  startTwoFactorSetup,
  completeTwoFactorSetup,
  disableTwoFactor,
  regenerateBackupCodes,
  verifyTwoFactorCode,
} from "@/lib/two-factor";

/**
 * GET /api/account/two-factor
 * Get 2FA status for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const status = await getTwoFactorStatus(payload.email);

    return NextResponse.json({
      enabled: status.enabled,
      hasBackupCodes: status.hasBackupCodes,
    });
  } catch (error) {
    console.error("2FA status error:", error);
    return NextResponse.json(
      { error: "Failed to get 2FA status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/account/two-factor
 * Manage 2FA: setup, confirm, disable, regenerate backup codes, or verify
 *
 * Body:
 * - action: "setup" | "confirm" | "disable" | "regenerate-backup-codes" | "verify"
 * - code: TOTP code (required for confirm, disable, verify)
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { action, code } = body;

    switch (action) {
      case "setup": {
        // Start 2FA setup - returns QR code and backup codes
        const setupData = await startTwoFactorSetup(payload.email);
        return NextResponse.json({
          qrCode: setupData.qrCode,
          secret: setupData.secret, // Show secret for manual entry
          backupCodes: setupData.backupCodes,
          message: "Scan the QR code with your authenticator app, then enter a code to confirm.",
        });
      }

      case "confirm": {
        // Complete 2FA setup by verifying the first code
        if (!code) {
          return NextResponse.json(
            { error: "Code is required" },
            { status: 400 }
          );
        }

        const result = await completeTwoFactorSetup(payload.email, code);
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
        // Disable 2FA (requires current code for security)
        if (!code) {
          return NextResponse.json(
            { error: "Code is required to disable 2FA" },
            { status: 400 }
          );
        }

        // Verify current code first
        const verifyResult = await verifyTwoFactorCode(payload.email, code);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: "Invalid code" },
            { status: 400 }
          );
        }

        await disableTwoFactor(payload.email);
        return NextResponse.json({
          success: true,
          message: "Two-factor authentication disabled.",
        });
      }

      case "regenerate-backup-codes": {
        // Regenerate backup codes (requires current code for security)
        if (!code) {
          return NextResponse.json(
            { error: "Code is required to regenerate backup codes" },
            { status: 400 }
          );
        }

        // Verify current code first
        const verifyResult = await verifyTwoFactorCode(payload.email, code);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: "Invalid code" },
            { status: 400 }
          );
        }

        const newCodes = await regenerateBackupCodes(payload.email);
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
        // Verify a 2FA code (for login flow)
        if (!code) {
          return NextResponse.json(
            { error: "Code is required" },
            { status: 400 }
          );
        }

        const verifyResult = await verifyTwoFactorCode(payload.email, code);
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
    console.error("2FA action error:", error);
    return NextResponse.json(
      { error: "Failed to process 2FA action" },
      { status: 500 }
    );
  }
}
