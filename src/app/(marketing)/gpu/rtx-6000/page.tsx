import { Metadata } from "next";
import { GPULandingPage } from "../components";
import type { GPUData } from "../components";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "NVIDIA RTX 6000 Pro GPU Rental | $0.66/hour | 96GB GDDR7",
  description: "Rent NVIDIA RTX 6000 Pro GPUs at $0.66/hour. 96GB GDDR7, Blackwell architecture. Best value for AI inference and development. No contracts, 99.9% SLA.",
  keywords: ["RTX 6000 Pro", "GPU rental", "NVIDIA RTX 6000", "AI inference", "machine learning", "cloud GPU", "GPU cloud", "rendering GPU", "rent RTX 6000", "affordable GPU cloud"],
  openGraph: {
    title: "NVIDIA RTX 6000 Pro GPU | $0.66/hour | 96GB | GPU Cloud",
    description: "Rent RTX 6000 Pro GPUs at $0.66/hour. 96GB GDDR7, Blackwell architecture. Best value for AI inference.",
    url: "https://example.com/gpu/rtx-6000",
    images: [{ url: "/clusters/gpu_rtx6000.webp", width: 1200, height: 630, alt: "NVIDIA RTX 6000 Pro GPU with 96GB GDDR7 memory available on GPU Cloud" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NVIDIA RTX 6000 Pro GPU | $0.66/hour | 96GB | GPU Cloud",
    description: "Rent RTX 6000 Pro GPUs at $0.66/hour. 96GB GDDR7, Blackwell architecture.",
  },
  alternates: {
    canonical: "https://example.com/gpu/rtx-6000",
  },
};

const rtx6000Data: GPUData = {
  id: "rtx6000",
  name: "RTX 6000 Pro",
  fullName: "NVIDIA RTX 6000 Pro",
  tagline: "$0.66/hour — Best Value for AI Inference",
  architecture: "Blackwell",
  memory: "96GB",
  memoryType: "GDDR7",
  hourlyPrice: 0.66,
  monthlyPrice: 481.80,
  location: "US West",
  image: "/clusters/gpu_rtx6000.webp",
  specs: [
    { label: "GPU Memory", value: "96GB GDDR7" },
    { label: "Architecture", value: "Blackwell" },
    { label: "Memory Bandwidth", value: "1.8 TB/s" },
    { label: "FP32 Performance", value: "91.1 TFLOPS" },
    { label: "Tensor Cores", value: "568" },
    { label: "RT Cores", value: "142" },
    { label: "PCIe Interface", value: "Gen5 x16" },
    { label: "TDP", value: "350W" },
  ],
  useCases: [
    {
      title: "AI Inference at Scale",
      description: "Run production inference workloads with low latency. 96GB handles large language models efficiently.",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    {
      title: "Model Development",
      description: "Iterate quickly on model development with professional-grade compute at startup-friendly prices.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    },
    {
      title: "3D Rendering",
      description: "Professional visualization and rendering with RT cores optimized for ray tracing workloads.",
      icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    },
    {
      title: "Video Processing",
      description: "Transcode, upscale, and process video content with hardware-accelerated NVENC/NVDEC.",
      icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
    },
  ],
  features: [
    "Raw SSH access",
    "Full sudo/root permissions",
    "Pre-installed CUDA & drivers",
    "Private networking available",
    "Persistent storage options",
    "24/7 technical support",
    "99.9% uptime SLA",
    "No long-term contracts",
    "Cancel anytime",
    "Deploy in under 5 minutes",
  ],
  comparisons: [
    { provider: "Exoscale", price: 2.15 },
    { provider: "Hyperstack", price: 1.80 },
    { provider: "Runpod", price: 1.69 },
    { provider: "GPU Cloud", price: 0.66 },
  ],
  faqs: [
    {
      q: "What workloads is the RTX 6000 Pro best for?",
      a: "The RTX 6000 Pro excels at AI inference, model development, 3D rendering, and video processing. Its 96GB GDDR7 memory handles most production LLM inference workloads, and the Blackwell architecture provides excellent price-performance for iteration and development.",
    },
    {
      q: "How does 96GB GDDR7 compare to HBM?",
      a: "GDDR7 offers excellent bandwidth at a lower cost than HBM. For inference and development workloads, you get 90%+ of the performance at a fraction of the price. For training very large models, H200 or B200 with HBM may be more appropriate.",
    },
    {
      q: "Can I run LLaMA 70B on the RTX 6000 Pro?",
      a: "Yes! With 96GB of VRAM, you can run LLaMA 70B with 4-bit quantization comfortably, or LLaMA 2 13B/7B at full precision. For full 70B at FP16, consider our H200 or B200 options.",
    },
    {
      q: "What's included in the $0.66/hour price?",
      a: "The price includes the GPU, CPU, RAM, storage, networking, CUDA drivers pre-installed, and 24/7 support. No hidden fees for ingress/egress within reasonable limits.",
    },
    {
      q: "How fast can I get started?",
      a: "Most users are up and running within 5 minutes. Sign up, add funds to your wallet ($50 minimum), and deploy. SSH access is provided immediately upon deployment.",
    },
    {
      q: "What if I need more GPUs?",
      a: "You can deploy multiple instances or contact us for dedicated multi-GPU nodes. We also offer H200 and B200 GPUs for more demanding workloads.",
    },
  ],
  ctaText: "Deploy RTX 6000 Pro",
  urgencyText: "Limited availability",
  socialProof: "Join 500+ teams running AI workloads on GPU Cloud",
};

export default function RTX6000Page() {
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "NVIDIA RTX 6000 Pro GPU Instance",
    description: "On-demand NVIDIA RTX 6000 Pro GPU with 96GB GDDR7 ECC memory, Blackwell architecture. Best value for AI inference, rendering, and development.",
    brand: { "@type": "Brand", name: "NVIDIA" },
    category: "GPU Cloud Computing",
    offers: {
      "@type": "Offer",
      price: "0.66",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "0.66",
        priceCurrency: "USD",
        unitText: "per hour",
        referenceQuantity: { "@type": "QuantitativeValue", value: "1", unitCode: "HUR" },
      },
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: "GPU Cloud", url: "https://example.com" },
      url: "https://example.com/gpu/rtx-6000",
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "GPU Memory", value: "96GB GDDR7 ECC" },
      { "@type": "PropertyValue", name: "Architecture", value: "Blackwell" },
      { "@type": "PropertyValue", name: "Memory Bandwidth", value: "1.8 TB/s" },
      { "@type": "PropertyValue", name: "FP32 Performance", value: "91.1 TFLOPS" },
      { "@type": "PropertyValue", name: "Tensor Cores", value: "568" },
      { "@type": "PropertyValue", name: "Location", value: "US West" },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: rtx6000Data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "GPUs", href: "/features#hardware" }, { name: "RTX PRO 6000", href: "/gpu/rtx-6000" }]} />
      <GPULandingPage gpu={rtx6000Data} />
    </>
  );
}
