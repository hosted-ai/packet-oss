import { Metadata } from "next";
import ComparisonPage from "../ComparisonPage";
import type { CompetitorData } from "../ComparisonPage";

export const metadata: Metadata = {
  title: "GPU Cloud vs Vast.ai - GPU Cloud Comparison 2026",
  description:
    "Compare GPU Cloud and Vast.ai GPU cloud pricing and features. Get the RTX PRO 6000 96GB at $0.66/hr — 30% less than Vast.ai with managed infrastructure.",
  keywords: [
    "Vast.ai alternative",
    "GPU Cloud vs Vast.ai",
    "Vast.ai comparison",
    "Vast.ai lower cost alternative",
    "GPU cloud comparison",
    "Vast.ai alternative Europe",
  ],
  openGraph: {
    title: "GPU Cloud vs Vast.ai - GPU Cloud Comparison 2026",
    description:
      "Compare GPU cloud pricing and features. RTX PRO 6000 at $0.66/hr vs $0.94/hr on Vast.ai.",
    url: "https://example.com/vs/vast-ai",
  },
  alternates: { canonical: "https://example.com/vs/vast-ai" },
};

const data: CompetitorData = {
  name: "Vast.ai",
  slug: "vast-ai",
  tagline: "Managed NVIDIA Blackwell GPUs with predictable pricing. No marketplace, no gamble.",
  description: "Vast.ai is a GPU marketplace connecting renters with providers. GPU Cloud offers managed infrastructure at lower prices.",
  pricing: [
    { gpu: "RTX PRO 6000 96GB (monthly)", competitorPrice: 0.94, packetPrice: 0.27, savings: "71% less" },
    { gpu: "RTX PRO 6000 96GB (hourly)", competitorPrice: 0.94, packetPrice: 0.66, savings: "30% less" },
    { gpu: "NVIDIA B200 180GB", competitorPrice: 2.65, packetPrice: 2.25, savings: "15% less" },
    { gpu: "NVIDIA H200 141GB", competitorPrice: 2.07, packetPrice: 1.50, savings: "28% less" },
  ],
  features: [
    { label: "Raw SSH access", packet: true, competitor: true },
    { label: "Full root/sudo", packet: true, competitor: true },
    { label: "No contracts required", packet: true, competitor: true },
    { label: "Managed infrastructure", packet: true, competitor: false },
    { label: "Consistent hardware quality", packet: true, competitor: "Varies by host" },
    { label: "US data centers", packet: true, competitor: "Varies by host" },
    { label: "RTX PRO 6000 96GB", packet: "$0.66/hr", competitor: "$0.94/hr" },
    { label: "99.9% uptime SLA", packet: true, competitor: false },
    { label: "OpenAI-compatible API", packet: true, competitor: false },
    { label: "24/7 support (40+ engineers)", packet: true, competitor: "Community only" },
    { label: "Persistent storage", packet: true, competitor: true },
    { label: "HuggingFace 1-click deploy", packet: true, competitor: false },
  ],
  reasons: [
    {
      title: "Managed infrastructure",
      description: "Vast.ai is a marketplace — hardware quality, uptime, and support vary by host. GPU Cloud manages all infrastructure directly with consistent quality and a 99.9% SLA.",
      icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    },
    {
      title: "30% less on RTX PRO 6000",
      description: "The RTX PRO 6000 96GB at $0.66/hr is the most competitive on the market. Vast.ai charges $0.94/hr for the same GPU — and their pricing fluctuates with marketplace demand.",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "Predictable pricing",
      description: "Vast.ai's marketplace pricing fluctuates with supply and demand. GPU Cloud offers fixed, transparent pricing — $0.66/hr for RTX PRO 6000, always.",
      icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
    },
    {
      title: "Known infrastructure",
      description: "All GPU Cloud GPUs run in our own managed US data centers. On Vast.ai, your data could end up on any host's hardware anywhere in the world with no visibility or control.",
      icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "Built-in LLM inference API",
      description: "Our inference API gives you an OpenAI-compatible API out of the box. No need to set up vLLM or manage inference infrastructure on marketplace GPUs.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    },
    {
      title: "Professional support",
      description: "Get 24/7 support from our engineering team. Vast.ai relies on community forums — there's no SLA on support response times.",
      icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z",
    },
  ],
  faqs: [
    {
      q: "Is GPU Cloud a good alternative to Vast.ai?",
      a: "Yes. GPU Cloud offers lower prices on key GPUs (RTX PRO 6000 at $0.66/hr vs $0.94/hr) with managed infrastructure and guaranteed uptime. Unlike Vast.ai's marketplace model, you get consistent hardware quality, 24/7 support, and 99.9% SLA.",
    },
    {
      q: "How does GPU Cloud's pricing compare to Vast.ai?",
      a: "GPU Cloud is 15-30% less on the main GPU models. RTX PRO 6000 96GB is $0.66/hr (vs $0.94), B200 is $2.25/hr (vs $2.65), and H200 is $1.50/hr (vs $2.07). GPU Cloud's prices are also fixed — they don't fluctuate with marketplace demand.",
    },
    {
      q: "Is Vast.ai reliable enough for production workloads?",
      a: "Vast.ai is a marketplace where individual hosts provide GPUs. Hardware quality, uptime, and support vary significantly. GPU Cloud manages all infrastructure directly with a 99.9% SLA, making it better suited for production workloads.",
    },
    {
      q: "Can I use my Vast.ai scripts on GPU Cloud?",
      a: "Yes. Both platforms provide SSH access. Your Docker containers, training scripts, and deployment workflows will work on GPU Cloud without modification.",
    },
    {
      q: "Does GPU Cloud have spot/interruptible instances like Vast.ai?",
      a: "GPU Cloud focuses on reliable on-demand instances with guaranteed availability and a 99.9% SLA. For cost-sensitive batch workloads, Our inference API offers batch processing at $0.05-0.08/M tokens.",
    },
  ],
};

export default function VastAiComparisonPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ComparisonPage data={data} />
    </>
  );
}
