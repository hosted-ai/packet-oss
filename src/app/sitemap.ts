import { MetadataRoute } from "next";
import { getAllPosts } from "./(marketing)/blog/posts";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://example.com";
  const now = new Date();

  // Core marketing pages
  const marketingPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/technology`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/use-cases`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/cli`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/for-providers`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/huggingface`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];

  // GPU product pages
  const gpuPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/gpu/b200`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/gpu/h200`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/gpu/rtx-6000`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/blackwell`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  // Documentation pages
  const docPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/docs/getting-started`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/docs/api-reference`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/ssh`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/huggingface`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/docs/storage`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/workspace`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/gpu-metrics`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/token-usage`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/blackwell`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/billing`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/budget-controls`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/browser-ide`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/inference-playground`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/ai`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/docs/service-exposure`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  // Blog index + individual posts
  const posts = getAllPosts();
  const blogPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...posts.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: new Date(post.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  // Competitor comparison pages
  const comparisonPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/vs/runpod`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/vast-ai`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/lambda-labs`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/coreweave`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/aws-gpu`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/hyperstack`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  // Legal pages
  const legalPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/sla`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
  ];

  return [
    ...marketingPages,
    ...gpuPages,
    ...comparisonPages,
    ...docPages,
    ...blogPages,
    ...legalPages,
  ];
}
