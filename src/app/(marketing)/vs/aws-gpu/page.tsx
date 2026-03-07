import { Metadata } from "next";
import ComparisonPage from "../ComparisonPage";
import type { CompetitorData } from "../ComparisonPage";

export const metadata: Metadata = {
  title: "GPU Cloud vs AWS GPU - Cloud GPU Comparison 2026",
  description:
    "Compare GPU Cloud and AWS GPU instance pricing. RTX PRO 6000 96GB from $0.27/hr. Save 75-98% vs AWS P5 and P4 instances with instant setup and no commitments.",
  keywords: ["AWS GPU alternative", "GPU Cloud vs AWS", "AWS P5 alternative", "AWS GPU lower cost alternative", "AWS GPU pricing comparison"],
  openGraph: {
    title: "GPU Cloud vs AWS GPU Instances - Comparison 2026",
    description: "Save 75-98% vs AWS GPU instances. RTX PRO 6000 96GB from $0.27/hr, deploy in under 5 minutes.",
    url: "https://example.com/vs/aws-gpu",
  },
  alternates: { canonical: "https://example.com/vs/aws-gpu" },
};

const data: CompetitorData = {
  name: "AWS",
  slug: "aws-gpu",
  tagline: "Enterprise NVIDIA GPUs without the procurement process. Typically 75%+ below AWS pricing.",
  description: "AWS offers GPU instances through EC2 P5, P4, and G6 families. Here's how GPU Cloud compares on pricing and experience.",
  pricing: [
    { gpu: "RTX PRO 6000 96GB (monthly)", competitorPrice: "Not available", packetPrice: 0.27, savings: "Exclusive" },
    { gpu: "RTX PRO 6000 96GB (hourly)", competitorPrice: "Not available", packetPrice: 0.66, savings: "Exclusive" },
    { gpu: "NVIDIA B200 180GB", competitorPrice: 14.24, packetPrice: 2.25, savings: "84% less" },
    { gpu: "NVIDIA H200 141GB", competitorPrice: 7.91, packetPrice: 1.50, savings: "81% less" },
    { gpu: "NVIDIA H100 80GB", competitorPrice: 6.88, packetPrice: 1.50, savings: "78% less" },
  ],
  features: [
    { label: "No contract required", packet: true, competitor: true },
    { label: "Self-serve signup", packet: "< 2 min", competitor: "Account + limits" },
    { label: "Deploy in < 5 minutes", packet: true, competitor: "Quota approval needed" },
    { label: "Single GPU rental", packet: true, competitor: "8-GPU packs only (P5)" },
    { label: "Raw SSH access", packet: true, competitor: true },
    { label: "24/7 support (included)", packet: true, competitor: "Business plan $100+/mo" },
    { label: "99.9% SLA (included)", packet: true, competitor: "99.99% (extra cost)" },
    { label: "US data centers", packet: true, competitor: true },
    { label: "Simple, flat pricing", packet: true, competitor: "Complex (on-demand/spot/reserved)" },
    { label: "OpenAI-compatible API", packet: true, competitor: false },
    { label: "No egress fees", packet: true, competitor: false },
    { label: "No hidden costs", packet: true, competitor: "Storage, network, EBS extra" },
  ],
  reasons: [
    {
      title: "75-98% less",
      description: "AWS charges $14.24/hr per B200 (p5.48xlarge ÷ 8). GPU Cloud charges $2.25/hr. H200: $7.91/hr vs $1.50/hr. RTX PRO 6000: $0.27/hr effective — AWS doesn't even offer it.",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      title: "No hidden costs",
      description: "AWS charges for storage (EBS), network transfer (egress), IP addresses, and more. GPU Cloud has one price — the GPU hourly rate. No surprises on your bill.",
      icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
    },
    {
      title: "No quota approvals",
      description: "AWS requires quota increase requests for GPU instances that can take hours or days. GPU Cloud: sign up, pick a GPU, deploy. Under 5 minutes, every time.",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
    },
    {
      title: "Single GPU available",
      description: "AWS P5 instances only come in 8-GPU packs ($113/hr minimum). GPU Cloud lets you rent a single GPU starting at $0.66/hr or $199/mo.",
      icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    },
    {
      title: "24/7 support included free",
      description: "AWS charges $100+/month for business support. GPU Cloud includes 24/7 engineering support and a real 99.9% SLA for every customer at no extra cost.",
      icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z",
    },
    {
      title: "Built-in LLM inference",
      description: "Deploy vLLM with OpenAI-compatible endpoints in minutes — no need for SageMaker, Bedrock, or complex AWS inference pipelines.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    },
  ],
  faqs: [
    { q: "How does GPU Cloud pricing compare to AWS GPU instances?", a: "75-98% less depending on the GPU. B200: $2.25/hr vs $14.24/hr (84% less). H200: $1.50/hr vs $7.91/hr (81% less). RTX PRO 6000 96GB: $0.27/hr effective ($199/mo) — AWS doesn't offer this GPU at all." },
    { q: "Can I use GPU Cloud instead of AWS SageMaker?", a: "For LLM inference, deploy vLLM on a GPU instance for an OpenAI-compatible API — much simpler and more cost-effective than SageMaker endpoints. For training, SSH into a GPU and run your code directly." },
    { q: "Does GPU Cloud have the same GPU availability as AWS?", a: "AWS GPU instances often require quota approvals and face availability constraints in many regions. GPU Cloud has RTX PRO 6000 GPUs available for instant deployment." },
    { q: "Is GPU Cloud secure enough for production?", a: "Yes. GPU Cloud provides 99.9% SLA, 24/7 support, enterprise-grade US data centers, and secure SSH access. For enterprise requirements, contact our sales team." },
    { q: "What about AWS spot instances for lower cost GPU pricing?", a: "AWS spot instances can be interrupted at any time with 2 minutes notice — disastrous for training runs. GPU Cloud's on-demand GPUs are reliable and still priced below AWS spot pricing for most GPU types." },
  ],
};

export default function AWSComparisonPage() {
  const faqJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: data.faqs.map((faq) => ({ "@type": "Question", name: faq.q, acceptedAnswer: { "@type": "Answer", text: faq.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ComparisonPage data={data} />
    </>
  );
}
