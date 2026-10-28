import { MetadataRoute } from "next";
import { isPro } from "@/lib/edition";
import { getAppUrl } from "@/lib/branding";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getAppUrl();
  const now = new Date();

  // Core pages available in all editions
  const corePages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/docs/getting-started`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/docs/api-reference`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/ssh`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/storage`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/gpu-metrics`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/billing`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/budget-controls`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/browser-ide`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/service-exposure`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  if (!isPro()) {
    return corePages;
  }

  // Pro-only documentation pages
  const proDocPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/docs/huggingface`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/token-factory`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/token-usage`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/blackwell`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/inference-playground`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/ai`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  return [...corePages, ...proDocPages];
}
