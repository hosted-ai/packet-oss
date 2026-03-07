import { Metadata } from "next";
import ComparisonPage from "../ComparisonPage";
import type { CompetitorData } from "../ComparisonPage";

export const metadata: Metadata = {
  title: "GPU Cloud vs RunPod - GPU Cloud Comparison 2026",
  description:
    "Compare GPU Cloud and RunPod GPU cloud pricing, features, and performance. Save up to 61% on B200, H200, and RTX 6000 GPUs.",
  keywords: [
    "RunPod alternative",
    "GPU Cloud vs RunPod",
    "RunPod comparison",
    "RunPod lower cost alternative",
    "GPU cloud comparison",
    "RunPod alternative Europe",
  ],
  openGraph: {
    title: "GPU Cloud vs RunPod - GPU Cloud Comparison 2026",
    description:
      "Compare GPU cloud pricing and features. Save up to 61% vs RunPod on B200, H200, and RTX 6000 GPUs.",
    url: "https://example.com/vs/runpod",
  },
  alternates: {
    canonical: "https://example.com/vs/runpod",
  },
};

const runpodData: CompetitorData = {
  name: "RunPod",
  slug: "runpod",
  tagline: "Full 96GB Blackwell GPUs with enterprise infrastructure. Typically 50%+ below RunPod.",
  description: "RunPod is a popular GPU cloud for AI developers. Here's how GPU Cloud compares on pricing, features, and infrastructure.",
  pricing: [
    { gpu: "RTX PRO 6000 96GB (monthly)", competitorPrice: 1.69, packetPrice: 0.27, savings: "84% less" },
    { gpu: "RTX PRO 6000 96GB (hourly)", competitorPrice: 1.69, packetPrice: 0.66, savings: "61% less" },
    { gpu: "NVIDIA B200 180GB", competitorPrice: 4.99, packetPrice: 2.25, savings: "55% less" },
    { gpu: "NVIDIA H200 141GB", competitorPrice: 3.59, packetPrice: 1.50, savings: "58% less" },
  ],
  features: [
    { label: "Raw SSH access", packet: true, competitor: true },
    { label: "Full root/sudo", packet: true, competitor: true },
    { label: "No contracts required", packet: true, competitor: true },
    { label: "US data centers", packet: true, competitor: true },
    { label: "NVIDIA B200 available", packet: true, competitor: true },
    { label: "RTX PRO 6000 Blackwell", packet: "96GB GDDR7", competitor: "48GB" },
    { label: "OpenAI-compatible API", packet: true, competitor: false },
    { label: "LLM inference API", packet: "$0.10/M tokens", competitor: "Serverless only" },
    { label: "Persistent storage", packet: true, competitor: true },
    { label: "HuggingFace 1-click deploy", packet: true, competitor: false },
    { label: "24/7 support (40+ engineers)", packet: true, competitor: "Community + paid" },
    { label: "99.9% SLA", packet: true, competitor: "99.9%" },
    { label: "Crypto payments", packet: true, competitor: true },
  ],
  reasons: [
    {
      title: "Up to 84% lower pricing",
      description: "RTX PRO 6000 96GB from $0.27/hr effective ($199/mo) or $0.66/hr on-demand — vs $1.69/hr on RunPod. B200 at $2.25/hr vs $4.99, H200 at $1.50/hr vs $3.59.",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "Enterprise-grade infrastructure",
      description: "US data centers with 99.9% SLA, 24/7 support from 40+ engineers, and enterprise security. No enterprise tier required — every customer gets the full package.",
      icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "Built-in LLM inference API",
      description: "our inference API provides an OpenAI-compatible API at $0.10-0.15/M tokens — no need to manage vLLM yourself. RunPod requires serverless setup or self-managed inference.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    },
    {
      title: "Simpler, no-nonsense platform",
      description: "Deploy a GPU, SSH in, and start working. No pods, no templates, no serverless complexity. Raw SSH access with full root permissions from minute one.",
      icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
    },
    {
      title: "Latest-gen Blackwell GPUs",
      description: "Access NVIDIA RTX PRO 6000 with the full 96GB GDDR7 — the best value GPU for AI inference at $0.66/hr. RunPod offers only the 48GB variant.",
      icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    },
    {
      title: "Transparent hourly billing",
      description: "Pay exactly for what you use. No hidden fees, no bandwidth charges, no egress costs. Hourly and monthly billing options with volume discounts.",
      icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
    },
  ],
  faqs: [
    {
      q: "Is GPU Cloud a good alternative to RunPod?",
      a: "Yes. GPU Cloud offers the same GPU models (B200, H200, H100) at significantly lower prices — up to 61% less. You also get an OpenAI-compatible LLM inference API, full SSH access, and no contracts.",
    },
    {
      q: "Can I migrate from RunPod to GPU Cloud easily?",
      a: "Yes. Both platforms provide SSH access to GPU instances. Your existing Docker containers, scripts, and workflows will work on GPU Cloud. If you use the OpenAI SDK, you can also switch your API calls to our inference API by changing one line of code.",
    },
    {
      q: "Does GPU Cloud support serverless GPU like RunPod?",
      a: "GPU Cloud focuses on dedicated GPU instances with SSH access, which gives you full control over your environment. For inference workloads, our inference API provides a managed OpenAI-compatible API that's simpler than configuring serverless endpoints.",
    },
    {
      q: "How is GPU Cloud priced lower than RunPod?",
      a: "GPU Cloud uses dynamic placement technology to achieve higher GPU utilisation rates, passing the savings to customers. Combined with competitive energy costs, this means significantly lower prices.",
    },
    {
      q: "Does GPU Cloud have GPU availability issues?",
      a: "We maintain dedicated inventory of B200, H200, and RTX 6000 Pro GPUs. Availability is shown in real-time on our dashboard. For guaranteed capacity, contact sales about reserved instances.",
    },
    {
      q: "Is my data safe on GPU Cloud vs RunPod?",
      a: "GPU Cloud runs from enterprise-grade US data centers with isolated instances, encrypted storage, and 24/7 monitoring. All customers get 99.9% SLA and dedicated support.",
    },
  ],
};

export default function RunPodComparisonPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: runpodData.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <ComparisonPage data={runpodData} />
    </>
  );
}
