import { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/branding";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs", "/docs/"],
        disallow: [
          "/admin",
          "/dashboard",
          "/api/",
          "/checkout",
          "/account",
          // Marketing surfaces moved to packet.ai (still 301-redirected here)
          "/about",
          "/blackwell",
          "/blog",
          "/cli",
          "/clusters",
          "/contact",
          "/demand",
          "/features",
          "/for-providers",
          "/gpu",
          "/privacy",
          "/providers/apply",
          "/request-quote",
          "/sla",
          "/technology",
          "/terms",
          "/token-factory",
          "/use-cases",
          "/vs",
        ],
      },
    ],
    sitemap: `${getAppUrl()}/sitemap.xml`,
  };
}
