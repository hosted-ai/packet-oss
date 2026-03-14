import { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/branding";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/dashboard", "/api/", "/checkout", "/account"],
      },
    ],
    sitemap: `${getAppUrl()}/sitemap.xml`,
  };
}
