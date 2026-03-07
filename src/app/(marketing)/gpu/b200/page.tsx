import { Metadata } from "next";
import { GPULandingPage } from "../components";
import type { GPUData } from "../components";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "NVIDIA B200 GPU Rental | $2.25/hour | 180GB HBM3e",
  description: "Rent NVIDIA B200 GPUs at $2.25/hour. 180GB HBM3e, Blackwell architecture, 8 TB/s bandwidth, 9,000 FP4 TFLOPS. Deploy in 5 minutes. No contracts, 99.9% SLA.",
  keywords: ["B200", "NVIDIA B200", "Blackwell GPU", "GPU rental", "HBM3e", "AI training", "LLM training", "cloud GPU", "GPU cloud", "B200 cloud", "rent B200"],
  openGraph: {
    title: "NVIDIA B200 GPU | $2.25/hour | 180GB HBM3e | GPU Cloud",
    description: "Rent B200 GPUs at $2.25/hour. 180GB HBM3e, Blackwell architecture, 8 TB/s bandwidth. No contracts, instant setup.",
    url: "https://example.com/gpu/b200",
    images: [{ url: "/b200-hero.webp", width: 1200, height: 630, alt: "NVIDIA B200 GPU with 180GB HBM3e memory available on GPU Cloud" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NVIDIA B200 GPU | $2.25/hour | 180GB HBM3e | GPU Cloud",
    description: "Rent B200 GPUs at $2.25/hour. 180GB HBM3e, Blackwell architecture, 8 TB/s bandwidth.",
  },
  alternates: {
    canonical: "https://example.com/gpu/b200",
  },
};

const b200Data: GPUData = {
  id: "b200",
  name: "B200",
  fullName: "NVIDIA B200 SXM",
  tagline: "$2.25/hour — Next-Gen Blackwell Power",
  architecture: "Blackwell",
  memory: "180GB",
  memoryType: "HBM3e",
  hourlyPrice: 2.25,
  monthlyPrice: 1642.50,
  location: "US",
  image: "/b200-hero.webp",
  specs: [
    { label: "GPU Memory", value: "180GB HBM3e" },
    { label: "Architecture", value: "Blackwell" },
    { label: "Memory Bandwidth", value: "8 TB/s" },
    { label: "FP16 Performance", value: "2,250 TFLOPS" },
    { label: "FP8 Performance", value: "4,500 TFLOPS" },
    { label: "FP4 Performance", value: "9,000 TFLOPS" },
    { label: "TDP", value: "1000W" },
  ],
  useCases: [
    {
      title: "Frontier Model Training",
      description: "Train the largest AI models with 180GB HBM3e and 8 TB/s bandwidth. The most powerful single GPU available.",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    {
      title: "100B+ Parameter Models",
      description: "Run and fine-tune models over 100B parameters. 180GB handles LLaMA 70B at FP16 with room for large batch sizes.",
      icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    },
    {
      title: "Real-Time AI Inference",
      description: "Serve multiple large models simultaneously with FP8/FP4 support for maximum throughput.",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
    },
    {
      title: "Research & Development",
      description: "Push the boundaries of AI research with the latest hardware. Access Blackwell before most cloud providers.",
      icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    },
  ],
  features: [
    "180GB HBM3e — largest available",
    "8 TB/s memory bandwidth",
    "2nd gen Transformer Engine",
    "FP4 tensor core support",
    "Raw SSH access",
    "Full sudo/root permissions",
    "Pre-installed CUDA 12.x",
    "PyTorch 2.x ready",
    "24/7 priority support",
    "99.9% uptime SLA",
  ],
  comparisons: [
    { provider: "AWS", price: 14.24, note: "8x ÷ 8" },
    { provider: "CoreWeave", price: 8.60, note: "8x ÷ 8" },
    { provider: "Lambda Labs", price: 5.29 },
    { provider: "Runpod", price: 4.99 },
    { provider: "GPU Cloud", price: 2.25 },
  ],
  faqs: [
    {
      q: "How is B200 different from H200/H100?",
      a: "The B200 is NVIDIA's latest Blackwell architecture with 2x the memory bandwidth (8 TB/s vs 4.8 TB/s), 30% more memory (180GB vs 141GB), and new FP4 tensor cores. It's designed for the next generation of AI models.",
    },
    {
      q: "When will B200 be available on other clouds?",
      a: "Major cloud providers have announced B200 but with limited availability in 2025. GPU Cloud offers B200 today with no waitlist, giving you a significant head start on competitors.",
    },
    {
      q: "What models can I run at full precision on B200?",
      a: "With 180GB HBM3e, you can run models up to ~85B parameters at FP16 on a single GPU. LLaMA 70B runs comfortably with large batch sizes. With FP8, you can effectively double this capacity.",
    },
    {
      q: "Is multi-GPU training supported?",
      a: "Yes! Contact us for dedicated multi-GPU clusters for distributed training at scale.",
    },
    {
      q: "What's the power situation?",
      a: "B200 has a 1000W TDP - all power and cooling is handled on our end. You just SSH in and run your workloads. No infrastructure concerns.",
    },
    {
      q: "Can I get a discount for long-term use?",
      a: "Yes! Monthly billing at $1,642.50 includes 730 hours (~27% savings vs hourly). For 6+ month commitments, contact us for additional volume discounts.",
    },
  ],
  ctaText: "Sign Up Free",
  urgencyText: "Currently sold out — sign up to get notified",
  socialProof: "Early access for teams pushing AI boundaries",
  soldOut: true,
};

export default function B200Page() {
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "NVIDIA B200 GPU Instance",
    description: "On-demand NVIDIA B200 GPU with 180GB HBM3e memory, Blackwell architecture, 8 TB/s bandwidth. Full SSH access, pre-installed CUDA, 99.9% SLA.",
    brand: { "@type": "Brand", name: "NVIDIA" },
    category: "GPU Cloud Computing",
    offers: {
      "@type": "Offer",
      price: "2.25",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "2.25",
        priceCurrency: "USD",
        unitText: "per hour",
        referenceQuantity: { "@type": "QuantitativeValue", value: "1", unitCode: "HUR" },
      },
      availability: "https://schema.org/SoldOut",
      seller: { "@type": "Organization", name: "GPU Cloud", url: "https://example.com" },
      url: "https://example.com/gpu/b200",
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "GPU Memory", value: "180GB HBM3e" },
      { "@type": "PropertyValue", name: "Architecture", value: "Blackwell" },
      { "@type": "PropertyValue", name: "Memory Bandwidth", value: "8 TB/s" },
      { "@type": "PropertyValue", name: "FP16 Performance", value: "2,250 TFLOPS" },
      { "@type": "PropertyValue", name: "FP8 Performance", value: "4,500 TFLOPS" },
      { "@type": "PropertyValue", name: "Location", value: "US" },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: b200Data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "GPUs", href: "/features#hardware" }, { name: "NVIDIA B200", href: "/gpu/b200" }]} />
      <GPULandingPage gpu={b200Data} />
    </>
  );
}
