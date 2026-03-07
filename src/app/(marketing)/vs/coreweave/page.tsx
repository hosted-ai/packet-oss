import { Metadata } from "next";
import ComparisonPage from "../ComparisonPage";
import type { CompetitorData } from "../ComparisonPage";

export const metadata: Metadata = {
  title: "GPU Cloud vs CoreWeave - GPU Cloud Comparison 2026",
  description:
    "Compare GPU Cloud and CoreWeave GPU cloud pricing. RTX PRO 6000 96GB from $0.27/hr effective with 24/7 support and 99.9% SLA — no enterprise contract required.",
  keywords: ["CoreWeave alternative", "GPU Cloud vs CoreWeave", "CoreWeave comparison", "CoreWeave lower cost", "CoreWeave alternative Europe"],
  openGraph: {
    title: "GPU Cloud vs CoreWeave - GPU Cloud Comparison 2026",
    description: "Compare GPU cloud pricing. RTX PRO 6000 96GB from $0.27/hr effective vs CoreWeave's enterprise-only pricing.",
    url: "https://example.com/vs/coreweave",
  },
  alternates: { canonical: "https://example.com/vs/coreweave" },
};

const data: CompetitorData = {
  name: "CoreWeave",
  slug: "coreweave",
  tagline: "Enterprise-grade GPUs without the enterprise contract. No minimums, no lock-in.",
  description: "CoreWeave targets large enterprises with committed contracts. GPU Cloud delivers the same GPU power with no contracts, 24/7 support, and a real 99.9% SLA.",
  pricing: [
    { gpu: "RTX PRO 6000 96GB (monthly)", competitorPrice: 2.50, packetPrice: 0.27, savings: "89% less" },
    { gpu: "RTX PRO 6000 96GB (hourly)", competitorPrice: 2.50, packetPrice: 0.66, savings: "74% less" },
    { gpu: "NVIDIA B200 180GB", competitorPrice: 8.60, packetPrice: 2.25, savings: "74% less" },
    { gpu: "NVIDIA H200 141GB", competitorPrice: 6.31, packetPrice: 1.50, savings: "76% less" },
  ],
  features: [
    { label: "No contract required", packet: true, competitor: false },
    { label: "Self-serve signup", packet: true, competitor: false },
    { label: "Deploy in < 5 minutes", packet: true, competitor: "Days/weeks" },
    { label: "24/7 support", packet: true, competitor: "Enterprise only" },
    { label: "99.9% SLA", packet: true, competitor: "Enterprise only" },
    { label: "Raw SSH access", packet: true, competitor: true },
    { label: "US data centers", packet: true, competitor: true },
    { label: "RTX PRO 6000 96GB", packet: "$0.66/hr", competitor: "$2.50/hr (8-pack)" },
    { label: "OpenAI-compatible API", packet: true, competitor: false },
    { label: "LLM inference API", packet: "$0.10/M tokens", competitor: false },
    { label: "Single GPU available", packet: true, competitor: "8-GPU minimum" },
    { label: "Pay-as-you-go", packet: true, competitor: "Committed only" },
  ],
  reasons: [
    {
      title: "No contract, no minimums",
      description: "CoreWeave requires committed contracts and typically 8-GPU minimums. GPU Cloud lets you deploy a single GPU instantly with hourly billing. Cancel anytime.",
      icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    },
    {
      title: "Up to 89% less",
      description: "RTX PRO 6000 96GB at $0.27/hr effective ($199/mo) vs CoreWeave's $2.50/hr. B200 at $2.25/hr vs $8.60. The savings are significant at any scale.",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "24/7 support for everyone",
      description: "GPU Cloud provides 24/7 engineering support and a real 99.9% SLA to every customer — not just enterprise accounts. CoreWeave reserves these for committed contracts.",
      icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z",
    },
    {
      title: "Deploy in minutes, not weeks",
      description: "CoreWeave's onboarding process involves sales calls, contracts, and provisioning that can take days or weeks. GPU Cloud: sign up, pick a GPU, SSH in. Under 5 minutes.",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
    },
    {
      title: "Enterprise-grade infrastructure",
      description: "GPU Cloud runs from US data centers with 99.9% SLA and 24/7 support for every customer. No enterprise tier required.",
      icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "Built-in inference API",
      description: "Our inference API provides OpenAI-compatible LLM inference at $0.10/M tokens. CoreWeave has no managed inference — you'd need to deploy and manage your own stack.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    },
  ],
  faqs: [
    { q: "Is GPU Cloud a good alternative to CoreWeave?", a: "Yes, especially if you don't want long-term contracts. GPU Cloud offers the same GPU models at up to 89% lower prices, with self-serve signup, instant deployment, 24/7 support, and a real 99.9% SLA for every customer." },
    { q: "Can I get a single GPU on CoreWeave?", a: "CoreWeave typically requires 8-GPU minimums with committed contracts. GPU Cloud lets you rent a single GPU with hourly billing and no contracts." },
    { q: "Is CoreWeave better for enterprise workloads?", a: "CoreWeave targets large enterprises with multi-year commitments. GPU Cloud serves the same workloads with more flexibility — no contracts, instant scaling, and 24/7 support with 99.9% SLA included for all customers." },
    { q: "Does GPU Cloud support Kubernetes like CoreWeave?", a: "GPU Cloud provides raw SSH access for maximum control. For managed inference, Our inference API handles scaling automatically. Contact us for custom Kubernetes cluster deployments." },
    { q: "How do I migrate from CoreWeave to GPU Cloud?", a: "Both platforms support SSH access and standard GPU workflows. Your training scripts, Docker containers, and models will work on GPU Cloud. Our team can help with migration planning — contact sales." },
  ],
};

export default function CoreWeaveComparisonPage() {
  const faqJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: data.faqs.map((faq) => ({ "@type": "Question", name: faq.q, acceptedAnswer: { "@type": "Answer", text: faq.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ComparisonPage data={data} />
    </>
  );
}
