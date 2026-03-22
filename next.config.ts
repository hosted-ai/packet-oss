import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

function getPackageVersion(): string {
  try {
    return readFileSync(join(process.cwd(), "VERSION"), "utf-8").trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["nodemailer"],
  env: {
    NEXT_PUBLIC_APP_VERSION: getPackageVersion(),
  },
  output: "standalone",
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
    remotePatterns: [
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_APP_HOSTNAME || "packet.ai",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
