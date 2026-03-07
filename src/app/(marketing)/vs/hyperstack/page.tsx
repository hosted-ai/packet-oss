import { Metadata } from "next";
import ComparisonPage from "../ComparisonPage";
import type { CompetitorData } from "../ComparisonPage";

export const metadata: Metadata = {
  title: "GPU Cloud vs Hyperstack - GPU Cloud Comparison 2026",
  description:
    "Compare GPU Cloud and Hyperstack GPU cloud. RTX PRO 6000 96GB at $0.27/hr effective vs $1.80/hr. 24/7 support from 40+ engineers with 99.9% SLA included.",
  keywords: ["Hyperstack alternative", "GPU Cloud vs Hyperstack", "Hyperstack comparison", "Hyperstack alternative", "European GPU cloud"],
  openGraph: {
    title: "GPU Cloud vs Hyperstack - GPU Cloud Comparison 2026",
    description: "RTX PRO 6000 at $0.27/hr effective vs $1.80/hr. Both European — GPU Cloud is priced significantly lower.",
    url: "https://example.com/vs/hyperstack",
  },
  alternates: { canonical: "https://example.com/vs/hyperstack" },
};

const data: CompetitorData = {
  name: "Hyperstack",
  slug: "hyperstack",
  tagline: "Both European GPU clouds — GPU Cloud is 63-85% less on every GPU.",
  description: "Hyperstack is a European GPU cloud by NexGen Cloud. Here's how GPU Cloud compares on pricing and features.",
  pricing: [
    { gpu: "RTX PRO 6000 96GB (monthly)", competitorPrice: 1.80, packetPrice: 0.27, savings: "85% less" },
    { gpu: "RTX PRO 6000 96GB (hourly)", competitorPrice: 1.80, packetPrice: 0.66, savings: "63% less" },
    { gpu: "NVIDIA H200 141GB", competitorPrice: 3.50, packetPrice: 1.50, savings: "57% less" },
  ],
  features: [
    { label: "US data centers", packet: true, competitor: false },
    { label: "Raw SSH access", packet: true, competitor: true },
    { label: "No contracts required", packet: true, competitor: true },
    { label: "RTX PRO 6000 96GB GDDR7", packet: "$0.66/hr", competitor: "$1.80/hr" },
    { label: "24/7 support (40+ engineers)", packet: true, competitor: "Business hours" },
    { label: "99.9% SLA included", packet: true, competitor: "Enterprise only" },
    { label: "OpenAI-compatible API", packet: true, competitor: false },
    { label: "LLM inference API", packet: "$0.10/M tokens", competitor: false },
    { label: "HuggingFace 1-click deploy", packet: true, competitor: false },
    { label: "Monthly billing ($199/mo)", packet: true, competitor: false },
    { label: "Crypto payments", packet: true, competitor: false },
  ],
  reasons: [
    {
      title: "63-85% less",
      description: "RTX PRO 6000 96GB at $0.27/hr effective ($199/mo) vs $1.80/hr on Hyperstack. H200 at $1.50/hr vs $3.50/hr. Every GPU is significantly less on GPU Cloud.",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "24/7 support from 40+ engineers",
      description: "GPU Cloud is backed by a team of 40+ world-class engineers providing round-the-clock support. Every customer gets 24/7 access and a real 99.9% SLA — not just enterprise accounts.",
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
    },
    {
      title: "Built-in LLM inference",
      description: "Our inference API gives you an OpenAI-compatible API at $0.10/M tokens. Hyperstack has no managed inference offering — you'd need to deploy vLLM or TGI yourself.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    },
    {
      title: "Flexible monthly billing",
      description: "Get the RTX PRO 6000 96GB at $199/month ($0.27/hr effective) with no commitment. Hyperstack only offers hourly billing at $1.80/hr.",
      icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    },
    {
      title: "HuggingFace integration",
      description: "Deploy any HuggingFace model with one click on GPU Cloud. Hyperstack requires manual setup for model deployment.",
      icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    },
    {
      title: "Enterprise-grade infrastructure",
      description: "GPU Cloud runs from US data centers with 99.9% SLA and 24/7 support from 40+ engineers. Hyperstack reserves enterprise SLAs for higher tiers only.",
      icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
  ],
  faqs: [
    { q: "How does GPU Cloud compare to Hyperstack?", a: "The main difference is pricing — GPU Cloud is 63-85% less on every GPU model. RTX PRO 6000 96GB: $0.27/hr effective vs $1.80/hr. H200: $1.50/hr vs $3.50/hr. GPU Cloud also includes 24/7 support and 99.9% SLA for all customers." },
    { q: "Does Hyperstack offer better support?", a: "GPU Cloud provides 24/7 support from a team of 40+ engineers for every customer. Hyperstack offers business-hours support with enterprise SLAs available only on higher tiers." },
  ],
};

export default function HyperstackComparisonPage() {
  const faqJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: data.faqs.map((faq) => ({ "@type": "Question", name: faq.q, acceptedAnswer: { "@type": "Answer", text: faq.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ComparisonPage data={data} />
    </>
  );
}
