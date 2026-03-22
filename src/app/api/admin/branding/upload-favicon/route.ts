import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { setSetting } from "@/lib/settings";
import fs from "fs";
import path from "path";
import sharp from "sharp";

function getAdminSession(request: NextRequest): { email: string } | null {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return null;
  return verifySessionToken(sessionToken);
}

export async function POST(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("favicon") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No favicon file provided" }, { status: 400 });
    }

    const allowedTypes = [
      "image/x-icon", "image/vnd.microsoft.icon",
      "image/png", "image/svg+xml", "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: ICO, PNG, SVG, WebP" },
        { status: 400 },
      );
    }

    const maxSize = 1 * 1024 * 1024; // 1 MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 1MB" },
        { status: 400 },
      );
    }

    const brandingDir = path.join(process.cwd(), "public", "branding");
    if (!fs.existsSync(brandingDir)) {
      fs.mkdirSync(brandingDir, { recursive: true });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    let filename: string;
    let outputBuffer: Buffer;

    if (file.type === "image/svg+xml" || file.type === "image/x-icon" || file.type === "image/vnd.microsoft.icon") {
      // Serve ICO and SVG as-is
      const ext = file.type === "image/svg+xml" ? "svg" : "ico";
      filename = `favicon_${Date.now()}.${ext}`;
      outputBuffer = inputBuffer;
    } else {
      // Convert PNG/WebP to a 48x48 PNG (standard favicon size)
      filename = `favicon_${Date.now()}.png`;
      outputBuffer = await sharp(inputBuffer)
        .resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    }

    const filePath = path.join(brandingDir, filename);
    fs.writeFileSync(filePath, outputBuffer);

    const faviconUrl = `/branding/${filename}`;

    await setSetting("NEXT_PUBLIC_FAVICON_URL", faviconUrl);

    console.log(`Favicon uploaded by ${session.email}: ${faviconUrl} (${outputBuffer.length} bytes)`);

    return NextResponse.json({ success: true, faviconUrl });
  } catch (error) {
    console.error("Failed to upload favicon:", error);
    return NextResponse.json(
      { error: "Failed to upload favicon" },
      { status: 500 },
    );
  }
}
