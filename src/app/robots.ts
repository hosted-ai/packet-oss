import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/dashboard", "/api/", "/checkout", "/account"],
      },
    ],
    sitemap: "https://the platform/sitemap.xml",
  };
}
