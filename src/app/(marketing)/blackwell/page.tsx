import { Metadata } from "next";
import { GPULandingPage } from "../gpu/components";
import type { GPUData } from "../gpu/components";

export const metadata: Metadata = {
  title: "NVIDIA RTX PRO 6000 Blackwell | $199/mo - the platform",
  description:
    "NVIDIA RTX PRO 6000 Blackwell GPUs for $199/mo ($0.27/hr effective). 96 GB GDDR7 ECC, 24,064 CUDA cores, 120 TFLOPS FP32, 4 PFLOPS FP4. Full root access, deploy in minutes.",
  keywords: [
    "RTX PRO 6000",
    "Blackwell",
    "NVIDIA Blackwell",
    "GPU rental",
    "GDDR7",
    "AI inference",
    "LLM inference",
    "cloud GPU",
    "GPU cloud",
    "affordable GPU",
  ],
  openGraph: {
    title: "NVIDIA RTX PRO 6000 Blackwell | $0.27/hr | 96GB GDDR7 | GPU Cloud",
    description:
      "Rent Blackwell RTX PRO 6000 GPUs at $0.27/hr effective ($199/mo). 96GB GDDR7 ECC, 24,064 CUDA cores. No contracts, instant setup.",
    url: "https://example.com/blackwell",
    images: [
      {
        url: "/clusters/rtx6000.jpeg",
        width: 1200,
        height: 630,
        alt: "NVIDIA RTX PRO 6000 Blackwell GPU available on GPU Cloud",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NVIDIA RTX PRO 6000 Blackwell | $0.27/hr | 96GB GDDR7 | GPU Cloud",
    description:
      "Rent Blackwell RTX PRO 6000 GPUs at $0.27/hr effective ($199/mo). 96GB GDDR7 ECC, 24,064 CUDA cores.",
  },
  alternates: {
    canonical: "https://example.com/blackwell",
  },
};

const blackwellData: GPUData = {
  id: "blackwell",
  name: "RTX PRO 6000",
  fullName: "NVIDIA RTX PRO 6000 Blackwell",
  tagline: "$0.27/hr effective — Full Blackwell Architecture",
  architecture: "Blackwell",
  memory: "96GB",
  memoryType: "GDDR7 ECC",
  hourlyPrice: 0.27,
  monthlyPrice: 199,
  location: "Atlanta, US",
  image: "/clusters/rtx6000.jpeg",
  specs: [
    { label: "GPU Memory", value: "96GB GDDR7 ECC" },
    { label: "Architecture", value: "Blackwell" },
    { label: "Memory Bandwidth", value: "1,597 GB/s" },
    { label: "FP32 Performance", value: "120 TFLOPS" },
    { label: "CUDA Cores", value: "24,064" },
    { label: "Tensor Cores", value: "752 (5th Gen)" },
    { label: "RT Cores", value: "188 (4th Gen)" },
    { label: "Peak AI (FP4)", value: "4 PFLOPS" },
    { label: "RT Performance", value: "355 TFLOPS" },
    { label: "PCIe", value: "Gen 5 x16" },
    { label: "TDP", value: "Up to 600W" },
    { label: "Memory Bus", value: "512-bit" },
  ],
  useCases: [
    {
      title: "LLM Inference at Scale",
      description:
        "Run 70B+ parameter models at full precision on a single GPU. Serve Llama, Mistral, Qwen, DeepSeek with vLLM, TGI, or Ollama. No sharding required.",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
    },
    {
      title: "Fine-Tuning Without Limits",
      description:
        "LoRA, QLoRA, and full fine-tuning on 96GB VRAM with 5th-gen Tensor Cores. 4 PFLOPS of FP4 AI compute accelerates every training step.",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    {
      title: "Image & Video Generation",
      description:
        "Run Flux, SDXL, CogVideoX, and Sora-class models with room to spare. 1,597 GB/s bandwidth means faster generation at higher resolutions.",
      icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    },
    {
      title: "Research & Development",
      description:
        "Full root SSH access. Install anything. PyTorch, JAX, CUDA — whatever your stack needs. 24,064 CUDA cores and 120 TFLOPS FP32 for compute-heavy experiments.",
      icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    },
  ],
  features: [
    "96GB GDDR7 ECC VRAM",
    "1,597 GB/s bandwidth",
    "5th-gen Tensor Cores",
    "FP4 AI acceleration",
    "Raw SSH access",
    "Full sudo/root permissions",
    "Pre-installed CUDA stack",
    "PyTorch & vLLM ready",
    "24/7 priority support",
    "99.9% uptime SLA",
  ],
  comparisons: [
    { provider: "Exoscale", price: 2.15 },
    { provider: "Sesterce", price: 1.97 },
    { provider: "Hyperstack", price: 1.80 },
    { provider: "RunPod", price: 1.69 },
    { provider: "Verda", price: 1.39 },
    { provider: "Vast.ai", price: 0.92 },
    { provider: "GPU Cloud", price: 0.27, note: "$199/mo flat" },
  ],
  faqs: [
    {
      q: "How is $0.27/hr possible?",
      a: "$199/month divided by 730 hours = $0.27/hr effective. The GPU is available 24/7 for the entire billing period. Higher utilization and no middlemen let us pass savings directly to you.",
    },
    {
      q: "Is this the full RTX PRO 6000?",
      a: "Yes. Full Blackwell architecture, unthrottled. 96GB GDDR7 ECC, 24,064 CUDA cores, 752 Tensor Cores, 4 PFLOPS FP4. Server Edition with all enterprise features.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Absolutely. No lock-in, no termination fees. Cancel through the dashboard and your subscription ends at the current period. No questions asked.",
    },
    {
      q: "What software is pre-installed?",
      a: "Ubuntu with the latest NVIDIA drivers and CUDA toolkit pre-configured. Full root access via SSH. Install Docker, PyTorch, vLLM, ComfyUI, or anything else you need.",
    },
    {
      q: "What models can I run on 96GB?",
      a: "Run 70B+ parameter models at full precision. Llama 3, Mistral, Qwen 72B, DeepSeek — all fit comfortably. With quantization, you can push well beyond 100B parameters.",
    },
    {
      q: "Where are the GPUs located?",
      a: "Atlanta, US datacenter with live inventory tracking. Instant provisioning — no waiting lists. Enterprise-grade 99.9% uptime SLA.",
    },
  ],
  billingPlan: "monthly",
  ctaText: "Deploy Blackwell GPU",
  urgencyText: "Limited availability",
  socialProof: "Trusted by AI teams running production workloads 24/7",
  heroBullets: ["96GB GDDR7 ECC", "Full root SSH", "Deploy in minutes"],
  terminalLines: [
    { prompt: "$", cmd: "ssh root@my-blackwell.the platform" },
    { cmd: "Welcome to Ubuntu 24.04 — CUDA 12.8", dim: true },
    { prompt: "$", cmd: "nvidia-smi --query-gpu=name,memory.total --format=csv" },
    { cmd: "NVIDIA RTX PRO 6000, 96 GB", dim: true },
    { prompt: "$", cmd: "vllm serve meta-llama/Llama-3.1-70B-Instruct" },
    { cmd: "INFO:  Serving on http://0.0.0.0:8000", dim: true },
  ],
};

export default function BlackwellPage() {
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "NVIDIA RTX PRO 6000 Blackwell GPU Instance",
    description:
      "On-demand NVIDIA RTX PRO 6000 Blackwell GPU with 96GB GDDR7 ECC memory, 24,064 CUDA cores, 120 TFLOPS FP32. Full SSH access, pre-installed CUDA, 99.9% SLA.",
    brand: { "@type": "Brand", name: "NVIDIA" },
    category: "GPU Cloud Computing",
    offers: {
      "@type": "Offer",
      price: "199.00",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "199.00",
        priceCurrency: "USD",
        unitText: "per month",
        referenceQuantity: {
          "@type": "QuantitativeValue",
          value: "1",
          unitCode: "MON",
        },
      },
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: "GPU Cloud",
        url: "https://example.com",
      },
      url: "https://example.com/blackwell",
    },
    additionalProperty: [
      {
        "@type": "PropertyValue",
        name: "GPU Memory",
        value: "96GB GDDR7 ECC",
      },
      { "@type": "PropertyValue", name: "Architecture", value: "Blackwell" },
      {
        "@type": "PropertyValue",
        name: "Memory Bandwidth",
        value: "1,597 GB/s",
      },
      {
        "@type": "PropertyValue",
        name: "FP32 Performance",
        value: "120 TFLOPS",
      },
      { "@type": "PropertyValue", name: "CUDA Cores", value: "24,064" },
      { "@type": "PropertyValue", name: "Location", value: "Atlanta, US" },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: blackwellData.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <GPULandingPage gpu={blackwellData} />
    </>
  );
}
