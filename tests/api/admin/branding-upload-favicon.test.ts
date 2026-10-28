// Tests for src/app/api/admin/branding/upload-favicon/route.ts (POST).
//
// PA-287 — admin branding favicon upload coverage. Admin-cookie gated. Reads a
// multipart "favicon" file, validates type (ICO/PNG/SVG/WebP) and size (<= 1MB),
// ensures public/branding exists, stores ICO/SVG verbatim while converting
// PNG/WebP to a 48x48 PNG via sharp, writes the file, and persists the URL via
// setSetting("NEXT_PUBLIC_FAVICON_URL").
//
// Mocked at the @/lib + fs + sharp boundary. verifySessionToken is synchronous.
// The sharp chain here is resize().png().toBuffer().

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
  mockPng,
  mockToBuffer,
} = vi.hoisted(() => {
  const mockToBuffer = vi.fn();
  const mockPng = vi.fn(() => ({ toBuffer: mockToBuffer }));
  const mockResize = vi.fn(() => ({ png: mockPng }));
  const mockSharp = vi.fn(() => ({ resize: mockResize }));
  return {
    mockVerifySessionToken: vi.fn(),
    mockSetSetting: vi.fn(),
    mockExistsSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockSharp,
    mockResize,
    mockPng,
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

import { POST } from "@/app/api/admin/branding/upload-favicon/route";

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
  return new NextRequest("http://localhost/api/admin/branding/upload-favicon", init);
}

function fileForm(
  { type = "image/png", size, content = "x" }: { type?: string; size?: number; content?: string } = {}
) {
  const data = size !== undefined ? "a".repeat(size) : content;
  const file = new File([data], "favicon", { type });
  const fd = new FormData();
  fd.append("favicon", file);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockSetSetting.mockResolvedValue(undefined);
  mockExistsSync.mockReturnValue(true);
  mockWriteFileSync.mockReturnValue(undefined);
  mockToBuffer.mockResolvedValue(Buffer.from("png-bytes"));
});

describe("POST /api/admin/branding/upload-favicon — auth gating", () => {
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

describe("POST /api/admin/branding/upload-favicon — validation", () => {
  it("returns 400 when no favicon file is provided", async () => {
    const res = await POST(makeReq({ formData: new FormData() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No favicon file provided");
  });

  it("returns 400 for a disallowed file type", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/gif" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid file type");
  });

  it("returns 400 when the file exceeds the 1MB limit", async () => {
    const res = await POST(
      makeReq({ formData: fileForm({ type: "image/png", size: 1 * 1024 * 1024 + 1 }) })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("File too large");
    expect(mockSharp).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/branding/upload-favicon — happy path (raster)", () => {
  it("converts a PNG to a 48x48 PNG via sharp and persists the URL", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.faviconUrl).toMatch(/^\/branding\/favicon_\d+\.png$/);
    expect(mockResize).toHaveBeenCalledWith(48, 48, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    expect(mockPng).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockSetSetting).toHaveBeenCalledWith("NEXT_PUBLIC_FAVICON_URL", body.faviconUrl);
  });

  it("accepts a WebP as a convertible raster type", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/webp" }) }));
    expect(res.status).toBe(200);
    expect(mockSharp).toHaveBeenCalledTimes(1);
  });

  it("creates the branding directory when it does not yet exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("branding"), {
      recursive: true,
    });
  });
});

describe("POST /api/admin/branding/upload-favicon — verbatim passthrough", () => {
  it("stores an SVG verbatim with a .svg URL (no sharp)", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/svg+xml" }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.faviconUrl).toMatch(/^\/branding\/favicon_\d+\.svg$/);
    expect(mockSharp).not.toHaveBeenCalled();
  });

  it("stores an ICO verbatim with a .ico URL (no sharp)", async () => {
    const res = await POST(makeReq({ formData: fileForm({ type: "image/x-icon" }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.faviconUrl).toMatch(/^\/branding\/favicon_\d+\.ico$/);
    expect(mockSharp).not.toHaveBeenCalled();
  });

  it("treats the vnd.microsoft.icon type as ICO passthrough", async () => {
    const res = await POST(
      makeReq({ formData: fileForm({ type: "image/vnd.microsoft.icon" }) })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.faviconUrl).toMatch(/\.ico$/);
    expect(mockSharp).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/branding/upload-favicon — error handling", () => {
  it("returns 500 when sharp conversion throws", async () => {
    mockToBuffer.mockRejectedValue(new Error("sharp boom"));
    const res = await POST(makeReq({ formData: fileForm({ type: "image/png" }) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to upload favicon");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("returns 500 when persisting the setting fails", async () => {
    mockSetSetting.mockRejectedValue(new Error("settings down"));
    const res = await POST(makeReq({ formData: fileForm({ type: "image/svg+xml" }) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to upload favicon");
  });
});
