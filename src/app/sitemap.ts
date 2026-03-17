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
    { url: `${baseUrl}/docs/workspace`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/gpu-metrics`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/billing`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/budget-controls`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/browser-ide`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/service-exposure`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  // Legal pages
  const legalPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/sla`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
  ];

  if (!isPro()) {
    return [...corePages, ...legalPages];
  }

  // Pro-only marketing pages (requires (marketing) directory)
  const marketingPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/technology`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/use-cases`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/token-factory`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/cli`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/clusters`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/for-providers`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/request-quote`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/huggingface`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];

  // GPU product pages
  const gpuPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/gpu/b200`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/gpu/h200`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/gpu/rtx-6000`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/blackwell`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/pxl`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  // Pro-only documentation pages
  const proDocPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/docs/openai-api`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/huggingface`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/token-factory`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/token-usage`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/blackwell`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/inference-playground`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/ai`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  // Blog index + individual posts (requires (marketing)/blog/posts)
  let blogPages: MetadataRoute.Sitemap = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const blogModule = "./(marketing)/blog/posts";
    const { getAllPosts } = require(blogModule);
    const posts = getAllPosts();
    blogPages = [
      { url: `${baseUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
      ...posts.map((post: { slug: string; publishedAt: string }) => ({
        url: `${baseUrl}/blog/${post.slug}`,
        lastModified: new Date(post.publishedAt),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    ];
  } catch {
    // Blog posts module not available (OSS build)
  }

  // Competitor comparison pages
  const comparisonPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/vs/runpod`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/vast-ai`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/lambda-labs`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/coreweave`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/aws-gpu`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/hyperstack`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  return [
    ...corePages,
    ...marketingPages,
    ...gpuPages,
    ...comparisonPages,
    ...proDocPages,
    ...blogPages,
    ...legalPages,
  ];
}
