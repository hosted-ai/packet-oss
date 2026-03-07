import { Metadata } from "next";
import { GPULandingPage } from "../components";
import type { GPUData } from "../components";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "NVIDIA H200 GPU Rental | $1.50/hour | 141GB HBM3e",
  description: "Rent NVIDIA H200 GPUs at $1.50/hour. 141GB HBM3e, Hopper architecture, 4.8 TB/s bandwidth. Train LLaMA 70B on one GPU. No contracts, 99.9% SLA.",
  keywords: ["H200", "NVIDIA H200", "GPU rental", "HBM3e", "Hopper GPU", "LLM training", "AI training", "cloud GPU", "H200 cloud", "rent H200"],
  openGraph: {
    title: "NVIDIA H200 GPU | $1.50/hour | 141GB HBM3e | GPU Cloud",
    description: "Rent H200 GPUs at $1.50/hour. 141GB HBM3e, Hopper architecture, 4.8 TB/s bandwidth. No contracts, instant setup.",
    url: "https://example.com/gpu/h200",
    images: [{ url: "/clusters/gpu_h200.webp", width: 1200, height: 630, alt: "NVIDIA H200 GPU with 141GB HBM3e memory available on GPU Cloud" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NVIDIA H200 GPU | $1.50/hour | 141GB HBM3e | GPU Cloud",
    description: "Rent H200 GPUs at $1.50/hour. 141GB HBM3e, Hopper architecture, 4.8 TB/s bandwidth.",
  },
  alternates: {
    canonical: "https://example.com/gpu/h200",
  },
};

const h200Data: GPUData = {
  id: "h200",
  name: "H200",
  fullName: "NVIDIA H200 SXM",
  tagline: "$1.50/hour — Maximum Memory for Large Models",
  architecture: "Hopper",
  memory: "141GB",
  memoryType: "HBM3e",
  hourlyPrice: 1.50,
  monthlyPrice: 1095.00,
  location: "US East",
  image: "/clusters/gpu_h200.webp",
  specs: [
    { label: "GPU Memory", value: "141GB HBM3e" },
    { label: "Architecture", value: "Hopper" },
    { label: "Memory Bandwidth", value: "4.8 TB/s" },
    { label: "FP16 Performance", value: "1,979 TFLOPS" },
    { label: "Tensor Cores", value: "528 (4th gen)" },
    { label: "FP8 Performance", value: "3,958 TFLOPS" },
    { label: "TDP", value: "700W" },
  ],
  useCases: [
    {
      title: "Large Language Model Training",
      description: "Train models up to 70B parameters on a single GPU. 141GB HBM3e eliminates memory bottlenecks.",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    {
      title: "Full-Precision Inference",
      description: "Run LLaMA 70B, Mixtral 8x22B, and other large models at FP16 without quantization.",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
    },
    {
      title: "Multi-Modal AI",
      description: "Process combined text, image, and video inputs for vision-language models like GPT-4V alternatives.",
      icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    },
    {
      title: "Scientific Computing",
      description: "HPC workloads benefit from massive HBM3e bandwidth and FP64 performance.",
      icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    },
  ],
  features: [
    "141GB HBM3e memory",
    "4.8 TB/s memory bandwidth",
    "Raw SSH access",
    "Full sudo/root permissions",
    "Pre-installed CUDA 12.x",
    "PyTorch/TensorFlow ready",
    "Private networking",
    "Persistent NVMe storage",
    "24/7 technical support",
    "99.9% uptime SLA",
  ],
  comparisons: [
    { provider: "AWS", price: 7.91, note: "8x ÷ 8" },
    { provider: "CoreWeave", price: 6.31, note: "8x ÷ 8" },
    { provider: "Runpod", price: 3.59 },
    { provider: "DigitalOcean", price: 3.44 },
    { provider: "GPU Cloud", price: 1.50 },
  ],
  faqs: [
    {
      q: "How is H200 different from H100?",
      a: "The H200 has 141GB of HBM3e memory vs H100's 80GB HBM3. This 76% more memory means you can run larger models without quantization or multi-GPU setups. Memory bandwidth is also increased to 4.8 TB/s from 3.35 TB/s.",
    },
    {
      q: "Can I train LLaMA 70B on a single H200?",
      a: "Yes! With 141GB HBM3e, you can fine-tune LLaMA 70B on a single GPU using techniques like LoRA or QLoRA. For full training, you'd want multiple H200s, which we can arrange.",
    },
    {
      q: "What models can I run at full precision?",
      a: "At FP16, you can run models up to ~65B parameters on a single H200. This includes LLaMA 70B (with some optimization), Falcon 40B, MPT 30B, and most vision-language models.",
    },
    {
      q: "What's the difference between hourly and monthly billing?",
      a: "Hourly billing charges only for time used - perfect for experiments and burst workloads. Monthly flat rate ($1,095) includes 730 hours and is best for always-on workloads, saving ~15% vs hourly.",
    },
    {
      q: "How fast is deployment?",
      a: "Most H200 instances are ready within 5 minutes. Sign up, deposit $50+, select H200, and you'll receive SSH credentials immediately upon deployment.",
    },
  ],
  ctaText: "Deploy H200 Now",
  urgencyText: "High demand — Limited units",
  socialProof: "Trusted by AI labs and enterprises running production workloads",
};

export default function H200Page() {
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "NVIDIA H200 GPU Instance",
    description: "On-demand NVIDIA H200 GPU with 141GB HBM3e memory, Hopper architecture, 4.8 TB/s bandwidth. Full SSH access, pre-installed CUDA, 99.9% SLA.",
    brand: { "@type": "Brand", name: "NVIDIA" },
    category: "GPU Cloud Computing",
    offers: {
      "@type": "Offer",
      price: "1.50",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "1.50",
        priceCurrency: "USD",
        unitText: "per hour",
        referenceQuantity: { "@type": "QuantitativeValue", value: "1", unitCode: "HUR" },
      },
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: "GPU Cloud", url: "https://example.com" },
      url: "https://example.com/gpu/h200",
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "GPU Memory", value: "141GB HBM3e" },
      { "@type": "PropertyValue", name: "Architecture", value: "Hopper" },
      { "@type": "PropertyValue", name: "Memory Bandwidth", value: "4.8 TB/s" },
      { "@type": "PropertyValue", name: "FP16 Performance", value: "1,979 TFLOPS" },
      { "@type": "PropertyValue", name: "FP8 Performance", value: "3,958 TFLOPS" },
      { "@type": "PropertyValue", name: "Location", value: "US East" },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: h200Data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "GPUs", href: "/features#hardware" }, { name: "NVIDIA H200", href: "/gpu/h200" }]} />
      <GPULandingPage gpu={h200Data} />
    </>
  );
}
