// Tests for src/app/api/admin/branding/upload-logo/route.ts (POST).
//
// PA-287 — admin branding logo upload coverage. Admin-cookie gated. The handler
// reads a multipart "logo" file, validates type (JPEG/PNG/WebP/SVG) and size
// (<= 2MB), ensures public/branding exists (fs), converts raster images to WebP
// via sharp (SVGs are stored verbatim), writes the file, and persists the
// resulting URL via setSetting("NEXT_PUBLIC_LOGO_URL").
//
// Mocked at the @/lib + fs + sharp boundary. verifySessionToken is synchronous
// → mockReturnValue. The sharp chain (resize().webp().toBuffer()) is mocked to
// resolve a Buffer. FormData/File are constructed with the global Web APIs so
// request.formData() parses them.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockSetSetting,
  mockExistsSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockSharp,
  mockResize,
  mockWebp,
  mockToBuffer,
} = vi.hoisted(() => {
  const mockToBuffer = vi.fn();
  const mockWebp = vi.fn(() => ({ toBuffer: mockToBuffer }));
  const mockResize = vi.fn(() => ({ webp: mockWebp }));
  const mockSharp = vi.fn(() => ({ resize: mockResize }));
  return {
    mockVerifySessionToken: vi.fn(),
    mockSetSetting: vi.fn(),
    mockExistsSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockSharp,
    mockResize,
    mockWebp,
    mockToBuffer,
  };
});

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/settings", () => ({ setSetting: mockSetSetting }));
vi.mock("fs", () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
  },
}));
vi.mock("sharp", () => ({ default: mockSharp }));

import { POST } from "@/app/api/admin/branding/upload-logo/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  { formData, withSession = true }: { formData?: FormData; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: { method: string; headers: Headers; body?: FormData } = {
    method: "POST",
    headers,
  };
  if (formData !== undefined) init.body = formData;
  return new NextRequest("http://localhost/api/admin/branding/upload-logo", init);
}

function fileForm(
  { type = "image/png", size, content = "x" }: { type?: string; size?: number; content?: string } = {}
) {
  const data = size !== undefined ? "a".repeat(size) : content;
  const file = new File([data], "logo.png", { type });
  const fd = new FormData();
  fd.append("logo", file);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockSetSetting.mockResolvedValue(undefined);
  mockExistsSync.mockReturnValue(true);
  mockWriteFileSync.mockReturnValue(undefined);
  mockToBuffer.mockResolvedValue(Buffer.from("webp-bytes"));
});

describe("POST /api/admin/branding/upload-logo — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makeReq({ formData: fileForm(), withSession: false }));
    expect(res.status).toBe(401);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq({ formData: fileForm() }));
    expect(res.status).toBe(401);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/branding/upload-logo — validation", () => {
  it("returns 400 when no logo file is provided", async () => {
    const res = await POST(makeReq({ formData: new FormData() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No logo file provided");
    expect(mockSharp).not.toHaveBeenCalled();
  });

  it("returns 400 for a disallowed file type", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/gif" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid file type");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("returns 400 when the file exceeds the 2MB limit", async () => {
    const res = await POST(
      makeReq({ formData: fileForm({ type: "image/png", size: 2 * 1024 * 1024 + 1 }) })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("File too large");
    expect(mockSharp).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/branding/upload-logo — happy path (raster)", () => {
  it("converts a PNG to WebP via sharp, writes it, and persists the URL", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.logoUrl).toMatch(/^\/branding\/logo_\d+\.webp$/);

    expect(mockSharp).toHaveBeenCalledTimes(1);
    expect(mockResize).toHaveBeenCalledWith(400, 100, {
      fit: "inside",
      withoutEnlargement: true,
    });
    expect(mockWebp).toHaveBeenCalledWith({ quality: 90 });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockSetSetting).toHaveBeenCalledWith("NEXT_PUBLIC_LOGO_URL", body.logoUrl);
  });

  it("accepts a JPEG and a WebP as valid raster types", async () => {
    const jpeg = await POST(makeReq({ formData: fileForm({ type: "image/jpeg" }) }));
    expect(jpeg.status).toBe(200);
    const webp = await POST(makeReq({ formData: fileForm({ type: "image/webp" }) }));
    expect(webp.status).toBe(200);
  });

  it("creates the branding directory when it does not yet exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("branding"), {
      recursive: true,
    });
  });
});

describe("POST /api/admin/branding/upload-logo — SVG passthrough", () => {
  it("stores an SVG verbatim (no sharp conversion) with a .svg URL", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/svg+xml" }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.logoUrl).toMatch(/^\/branding\/logo_\d+\.svg$/);
    expect(mockSharp).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockSetSetting).toHaveBeenCalledWith("NEXT_PUBLIC_LOGO_URL", body.logoUrl);
  });
});

describe("POST /api/admin/branding/upload-logo — error handling", () => {
  it("returns 500 when sharp conversion throws", async () => {
    mockToBuffer.mockRejectedValue(new Error("sharp boom"));
    const res = await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to upload logo");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("returns 500 when the file write fails", async () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });
    const res = await POST(makeReq({ formData: fileForm({ type: "image/svg+xml" }) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to upload logo");
  });

  it("returns 500 when persisting the setting fails", async () => {
    mockSetSetting.mockRejectedValue(new Error("settings down"));
    const res = await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to upload logo");
  });
});
