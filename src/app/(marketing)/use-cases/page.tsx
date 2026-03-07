import { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "GPU Use Cases - AI Inference, Training & Generation",
  description:
    "Run production AI workloads on NVIDIA RTX PRO 6000 Blackwell GPUs. 96GB GDDR7, $0.66/hr. LLM inference, image generation, fine-tuning, and more.",
  alternates: {
    canonical: "https://example.com/use-cases",
  },
};

const USE_CASES = [
  {
    icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    title: "LLM Inference",
    subtitle: "Serve open-source models in production",
    description:
      "Run Llama 3.1 70B, Mixtral, Qwen, and DeepSeek at production throughput. 96GB fits most open models at FP16 with room for KV cache and batching.",
    models: ["Llama 3.1 70B", "Mixtral 8x22B", "Qwen 72B", "DeepSeek 67B"],
    metrics: { label: "~80 tok/s", detail: "Llama 70B, vLLM, FP16" },
    replaces: "Multi-GPU clusters for 70B-class inference",
    color: "#1a4fff",
  },
  {
    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    title: "Image Generation",
    subtitle: "FLUX, SDXL, and Stable Diffusion",
    description:
      "Generate images with FLUX.1, SDXL, and SD3 at full resolution. No API rate limits. Self-host your image pipeline with complete control over parameters.",
    models: ["FLUX.1 Schnell", "FLUX.1 Dev", "SDXL 1.0", "SD3 Medium"],
    metrics: { label: "<2s", detail: "FLUX Schnell, 1024x1024" },
    replaces: "Per-image API costs",
    color: "#8b5cf6",
  },
  {
    icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
    title: "Video Generation",
    subtitle: "Wan 2.1, CogVideo, and more",
    description:
      "Generate AI video with Wan 2.1 (text-to-video and image-to-video) at up to 720p. 96GB VRAM handles the 14B parameter models that produce the highest quality output.",
    models: ["Wan 2.1 T2V 14B", "Wan 2.1 I2V 720p", "Wan 2.1 Fast 1.3B"],
    metrics: { label: "720p", detail: "Wan 2.1 Pro, 14B model" },
    replaces: "Rate-limited video generation APIs",
    color: "#ec4899",
  },
  {
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    title: "Fine-tuning",
    subtitle: "LoRA, QLoRA, and full parameter",
    description:
      "Fine-tune 7B-70B models with LoRA adapters on a single GPU. Iterate weekly as you collect data without multi-node coordination or reserved capacity.",
    models: ["LoRA / QLoRA", "Full fine-tune up to 30B", "DPO / RLHF"],
    metrics: { label: "70B LoRA", detail: "Single GPU, no coordination" },
    replaces: "Reserved multi-GPU training clusters",
    color: "#f97316",
  },
  {
    icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z",
    title: "Audio & Speech",
    subtitle: "Transcription and TTS at scale",
    description:
      "Run Whisper Large V3 for batch transcription at fixed cost. Process hundreds of hours per day without per-minute API charges. TTS with XTTS and Bark.",
    models: ["Whisper Large V3", "XTTS v2", "Bark", "MusicGen"],
    metrics: { label: "100+ hrs/day", detail: "Whisper, fixed cost" },
    replaces: "Per-minute transcription APIs",
    color: "#14b8a6",
  },
  {
    icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    title: "Embeddings & RAG",
    subtitle: "Semantic search pipelines",
    description:
      "Batch embedding generation for retrieval-augmented generation. Run E5, BGE, or GTE models at scale for semantic search, document processing, and knowledge bases.",
    models: ["E5-Large", "BGE-M3", "GTE-Large", "Nomic Embed"],
    metrics: { label: "10M+ vec/day", detail: "Batch processing" },
    replaces: "Pay-per-token embedding APIs",
    color: "#0ea5e9",
  },
];

const MEMORY_FIT = [
  { model: "Llama 3.1 70B (FP16)", memory: 140, total: 96, note: "Fits with FP8 quantization (35GB)" },
  { model: "Llama 3.1 70B (FP8)", memory: 35, total: 96, fits: true },
  { model: "Mixtral 8x22B (FP8)", memory: 44, total: 96, fits: true },
  { model: "Qwen 72B (FP8)", memory: 36, total: 96, fits: true },
  { model: "Llama 3.1 8B (FP16)", memory: 16, total: 96, fits: true },
  { model: "FLUX.1 Dev", memory: 24, total: 96, fits: true },
  { model: "Wan 2.1 14B (FP8)", memory: 28, total: 96, fits: true },
];

const BUSINESS_PATTERNS = [
  { type: "AI SaaS startups", model: "70B quantized", why: "Traffic doesn't justify a cluster", saves: "60-80%" },
  { type: "Internal enterprise tools", model: "8B-70B", why: "Limited user base, cost matters", saves: "70-90%" },
  { type: "Agency / consulting", model: "Various per client", why: "Different models per project", saves: "50-70%" },
  { type: "Vertical AI products", model: "Fine-tuned 7-13B", why: "Specialized, not huge scale", saves: "60-80%" },
  { type: "Image gen platforms", model: "FLUX / SDXL", why: "Per-image economics work", saves: "80-95%" },
  { type: "Transcription services", model: "Whisper Large", why: "Async batch processing", saves: "70-90%" },
  { type: "Embedding pipelines", model: "E5 / BGE", why: "Throughput over latency", saves: "80-95%" },
];

const GPU_LINEUP = [
  { name: "RTX PRO 6000", arch: "Blackwell", vram: "96GB", type: "GDDR7", price: "$0.66", highlight: true, available: true, href: "/gpu/rtx-6000" },
  { name: "B200", arch: "Blackwell", vram: "180GB", type: "HBM3e", price: "$2.00", highlight: false, available: false, href: "/gpu/b200" },
  { name: "H200", arch: "Hopper", vram: "141GB", type: "HBM3e", price: "$3.50", highlight: false, available: false, href: "/gpu/h200" },
  { name: "H100", arch: "Hopper", vram: "80GB", type: "HBM3", price: "$2.49", highlight: false, available: false, href: "" },
  { name: "A100 80GB", arch: "Ampere", vram: "80GB", type: "HBM2e", price: "$1.89", highlight: false, available: false, href: "" },
];

const FAQS = [
  { q: "What AI workloads can I run on the RTX PRO 6000?", a: "The RTX PRO 6000 with 96GB GDDR7 handles LLM inference (Llama 70B, Mixtral, Qwen), image generation (FLUX.1, SDXL), video generation (Wan 2.1), fine-tuning (LoRA/QLoRA), audio processing (Whisper), and embedding pipelines." },
  { q: "Can Llama 70B run on a single RTX PRO 6000?", a: "Yes. Llama 3.1 70B fits on a single RTX PRO 6000 with FP8 quantization, using about 35GB of the 96GB available. This leaves plenty of room for KV cache and batching." },
  { q: "How much does it cost to run LLM inference 24/7?", a: "An RTX PRO 6000 at $0.66/hr costs about $481/month running 24/7. With monthly billing at $199/mo ($0.27/hr effective), it's even more affordable. Compare this to $1,440-2,880/mo for H100 on other clouds." },
  { q: "Is the RTX PRO 6000 good for production inference?", a: "Yes. The RTX PRO 6000 Blackwell delivers ~80 tokens/sec on Llama 70B via vLLM. With 96GB GDDR7 and 1.8 TB/s bandwidth, it's the best value GPU for production AI inference." },
  { q: "Do I need to manage the GPU myself?", a: "You get full root SSH access and can install anything you need. All instances come pre-configured with CUDA, Python, and popular ML libraries so you can start running models immediately." },
];

export default function UseCasesPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Use Cases", href: "/use-cases" }]} />
      {/* Hero */}
      <section className="hero" style={{ paddingTop: "100px", paddingBottom: "40px" }}>
        <div className="container">
          <div style={{ maxWidth: "780px", margin: "0 auto", textAlign: "center" }}>
            <div
              className="pill"
              style={{ marginBottom: "24px", marginLeft: "auto", marginRight: "auto" }}
            >
              RTX PRO 6000 Blackwell Available Now
            </div>
            <h1
              className="display"
              style={{
                fontSize: "clamp(2.4rem, 5vw, 3.6rem)",
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
                marginBottom: "20px",
              }}
            >
              One GPU.{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, var(--blue), var(--teal))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Every AI workload.
              </span>
            </h1>
            <p
              style={{
                fontSize: "1.15rem",
                color: "var(--muted)",
                lineHeight: 1.7,
                maxWidth: "560px",
                margin: "0 auto 32px",
              }}
            >
              Run LLMs, generate images and video, fine-tune models, and build
              AI products on 96GB NVIDIA Blackwell GPUs. Full root SSH, no contracts,
              and typically 50%+ below market.
            </p>
            <div className="cta-row" style={{ justifyContent: "center" }}>
              <Link href="/account" className="btn primary">
                Deploy Now
              </Link>
              <Link href="/gpu/rtx-6000" className="btn ghost">
                RTX PRO 6000 Specs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* GPU Spec Bar */}
      <section style={{ padding: "0 0 80px" }}>
        <div className="container">
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
              overflow: "hidden",
              flexWrap: "wrap",
            }}
          >
            {[
              { value: "96GB", label: "GDDR7 ECC Memory" },
              { value: "1.8 TB/s", label: "Memory Bandwidth" },
              { value: "568", label: "Tensor Cores" },
              { value: "91.1 TFLOPS", label: "FP32 Performance" },
              { value: "$0.66/hr", label: "Hourly Price" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                style={{
                  flex: "1 1 140px",
                  padding: "28px 20px",
                  textAlign: "center",
                  borderLeft: i > 0 ? "1px solid var(--line)" : "none",
                }}
              >
                <div
                  className="display"
                  style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "4px" }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Grid */}
      <section id="use-cases" style={{ padding: "0 0 80px" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              What You Can Run
            </h2>
            <p>
              One GPU, six categories of AI workloads. All on RTX PRO 6000 Blackwell.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: "16px",
            }}
          >
            {USE_CASES.map((uc) => (
              <div
                key={uc.title}
                style={{
                  background: "var(--panel)",
                  borderRadius: "16px",
                  padding: "28px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  transition: "box-shadow 0.2s ease",
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: `${uc.color}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      style={{ width: "20px", height: "20px", color: uc.color }}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={uc.icon}
                      />
                    </svg>
                  </div>
                  <div>
                    <h3
                      className="display"
                      style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}
                    >
                      {uc.title}
                    </h3>
                    <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
                      {uc.subtitle}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p style={{ fontSize: "14px", color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
                  {uc.description}
                </p>

                {/* Models */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {uc.models.map((model) => (
                    <span
                      key={model}
                      style={{
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 500,
                        background: `${uc.color}10`,
                        color: uc.color,
                        borderRadius: "6px",
                      }}
                    >
                      {model}
                    </span>
                  ))}
                </div>

                {/* Metrics + Replaces */}
                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--line)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: uc.color }}>
                      {uc.metrics.label}
                    </span>
                    <span
                      style={{ fontSize: "12px", color: "var(--muted)", marginLeft: "6px" }}
                    >
                      {uc.metrics.detail}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--muted)",
                      fontStyle: "italic",
                    }}
                  >
                    Replaces: {uc.replaces}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Memory Visualization */}
      <section
        style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}
      >
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              What Fits on 96GB
            </h2>
            <p>
              Model memory footprints on a single RTX PRO 6000. Most production
              models fit comfortably with room for batching.
            </p>
          </div>

          <div
            style={{
              background: "var(--panel)",
              borderRadius: "16px",
              padding: "32px",
              border: "1px solid var(--line)",
              maxWidth: "800px",
              margin: "0 auto",
            }}
          >
            {/* Capacity bar */}
            <div style={{ marginBottom: "28px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "var(--muted)",
                }}
              >
                <span>0 GB</span>
                <span style={{ color: "var(--blue)", fontWeight: 600 }}>
                  96 GB RTX PRO 6000
                </span>
              </div>
              <div
                style={{
                  height: "8px",
                  background: "rgba(26, 79, 255, 0.12)",
                  borderRadius: "4px",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "-4px",
                    bottom: "-4px",
                    width: "2px",
                    background: "var(--blue)",
                  }}
                />
              </div>
            </div>

            {/* Model bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {MEMORY_FIT.map((item) => {
                const fits = item.fits !== undefined ? item.fits : false;
                const barWidth = fits
                  ? (item.memory / 96) * 100
                  : Math.min((item.memory / 96) * 100, 100);
                return (
                  <div
                    key={item.model}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "180px",
                        fontSize: "13px",
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {item.model}
                    </div>
                    <div style={{ flex: 1, position: "relative" }}>
                      <div
                        style={{
                          height: "24px",
                          width: `${Math.min(barWidth, 100)}%`,
                          background: fits ? "var(--blue)" : "#ef4444",
                          borderRadius: "4px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          paddingRight: "8px",
                          color: "#fff",
                          fontSize: "11px",
                          fontWeight: 600,
                          minWidth: "40px",
                        }}
                      >
                        {item.memory}GB
                      </div>
                    </div>
                    <div style={{ width: "50px", textAlign: "right", flexShrink: 0 }}>
                      {fits ? (
                        <svg
                          style={{ width: "16px", height: "16px", color: "#16a34a" }}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 500 }}>
                          FP8
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: "20px",
                paddingTop: "14px",
                borderTop: "1px solid var(--line)",
                fontSize: "12px",
                color: "var(--muted)",
                display: "flex",
                gap: "16px",
                flexWrap: "wrap",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "2px",
                    background: "var(--blue)",
                  }}
                />
                Fits on 96GB
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "2px",
                    background: "#ef4444",
                  }}
                />
                Requires quantization (FP8)
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Dark Mock Terminal */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Deploy in Minutes
            </h2>
            <p>SSH access, pre-configured CUDA, and your model running in under 5 minutes.</p>
          </div>

          <div
            style={{
              background: "#0b0f1c",
              borderRadius: "16px",
              padding: "32px",
              border: "1px solid rgba(255,255,255,0.08)",
              maxWidth: "800px",
              margin: "0 auto",
            }}
          >
            {/* Terminal header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "20px",
              }}
            >
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ff5f56" }} />
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ffbd2e" }} />
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#27c93f" }} />
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "#5b6476" }}>
                packet-rtx6000 ~ $
              </span>
            </div>

            <pre
              style={{
                color: "#e4e7ef",
                fontSize: "13px",
                lineHeight: 1.8,
                fontFamily: "var(--font-mono, monospace)",
                margin: 0,
                overflow: "auto",
              }}
            >
              <code>{`$ nvidia-smi --query-gpu=name,memory.total --format=csv
name, memory.total [MiB]
NVIDIA RTX PRO 6000, 98304 MiB

$ pip install vllm && vllm serve meta-llama/Llama-3.1-70B-Instruct \\
    --quantization fp8 --max-model-len 32768

INFO: Model loaded in 45.2s
INFO: Using 35.1 GB of 96.0 GB GPU memory
INFO: Serving on http://0.0.0.0:8000
INFO: Available routes: /v1/chat/completions, /v1/completions

$ curl localhost:8000/v1/chat/completions \\
    -d '{"model":"meta-llama/Llama-3.1-70B-Instruct",
         "messages":[{"role":"user","content":"Hello!"}]}'

{"choices":[{"message":{"content":"Hello! How can I help..."}}]}`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Business Patterns */}
      <section style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Is This Your Workload?
            </h2>
            <p>
              Common production patterns that run cost-effectively on a single
              RTX PRO 6000.
            </p>
          </div>

          {/* Dark table */}
          <div
            style={{
              background: "#0b0f1c",
              borderRadius: "16px",
              border: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "13px",
                  color: "#e4e7ef",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th
                      style={{
                        padding: "16px 20px",
                        textAlign: "left",
                        fontWeight: 600,
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#5b6476",
                      }}
                    >
                      Business Type
                    </th>
                    <th
                      style={{
                        padding: "16px 20px",
                        textAlign: "left",
                        fontWeight: 600,
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#5b6476",
                      }}
                    >
                      Typical Model
                    </th>
                    <th
                      style={{
                        padding: "16px 20px",
                        textAlign: "left",
                        fontWeight: 600,
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#5b6476",
                      }}
                    >
                      Why It Works
                    </th>
                    <th
                      style={{
                        padding: "16px 20px",
                        textAlign: "right",
                        fontWeight: 600,
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#5b6476",
                      }}
                    >
                      Savings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BUSINESS_PATTERNS.map((pattern, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom:
                          idx < BUSINESS_PATTERNS.length - 1
                            ? "1px solid rgba(255,255,255,0.05)"
                            : "none",
                      }}
                    >
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>
                        {pattern.type}
                      </td>
                      <td style={{ padding: "14px 20px", color: "#18b6a8" }}>
                        {pattern.model}
                      </td>
                      <td style={{ padding: "14px 20px", color: "#5b6476" }}>
                        {pattern.why}
                      </td>
                      <td
                        style={{
                          padding: "14px 20px",
                          textAlign: "right",
                          color: "#16a34a",
                          fontWeight: 600,
                        }}
                      >
                        {pattern.saves}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{
              textAlign: "center",
              marginTop: "24px",
              fontSize: "14px",
              color: "var(--muted)",
            }}
          >
            Not sure if your workload fits?{" "}
            <Link href="/contact" style={{ color: "var(--blue)", fontWeight: 500 }}>
              Talk to an engineer
            </Link>{" "}
            - we&apos;ll tell you honestly.
          </div>
        </div>
      </section>

      {/* Cost Comparison */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              The Economics
            </h2>
            <p>
              Why RTX PRO 6000 is the best value for production AI workloads.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "12px",
              maxWidth: "900px",
              margin: "0 auto 40px",
            }}
          >
            {[
              {
                label: "RTX PRO 6000",
                price: "$0.66/hr",
                detail: "96GB GDDR7, Blackwell",
                highlight: true,
              },
              {
                label: "H100 (other clouds)",
                price: "$2-4/hr",
                detail: "80GB HBM3",
                highlight: false,
              },
              {
                label: "8x A100 Cluster",
                price: "$8-12/hr",
                detail: "Typical cloud minimum",
                highlight: false,
              },
              {
                label: "OpenAI API",
                price: "~$3/M tok",
                detail: "GPT-4o equivalent",
                highlight: false,
              },
            ].map((opt) => (
              <div
                key={opt.label}
                style={{
                  padding: "24px",
                  borderRadius: "14px",
                  background: opt.highlight ? "var(--blue)" : "var(--panel)",
                  border: opt.highlight ? "none" : "1px solid var(--line)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: opt.highlight ? "rgba(255,255,255,0.7)" : "var(--muted)",
                    marginBottom: "8px",
                  }}
                >
                  {opt.label}
                </div>
                <div
                  className="display"
                  style={{
                    fontSize: "1.6rem",
                    fontWeight: 700,
                    color: opt.highlight ? "#fff" : "var(--ink)",
                    marginBottom: "4px",
                  }}
                >
                  {opt.price}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: opt.highlight ? "rgba(255,255,255,0.6)" : "var(--muted)",
                  }}
                >
                  {opt.detail}
                </div>
              </div>
            ))}
          </div>

          {/* Monthly savings callout */}
          <div
            style={{
              maxWidth: "600px",
              margin: "0 auto",
              background: "rgba(22, 163, 74, 0.08)",
              border: "1px solid rgba(22, 163, 74, 0.2)",
              borderRadius: "12px",
              padding: "20px 24px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px" }}>
              Running 24/7 for a month
            </div>
            <div className="display" style={{ fontSize: "1.3rem", fontWeight: 700 }}>
              $481/mo{" "}
              <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--muted)" }}>
                for 96GB Blackwell
              </span>
            </div>
            <div style={{ fontSize: "13px", color: "#16a34a", marginTop: "4px", fontWeight: 500 }}>
              vs $1,440-2,880/mo for H100 on other clouds
            </div>
          </div>
        </div>
      </section>

      {/* GPU Lineup */}
      <section style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Full GPU Lineup
            </h2>
            <p>Choose the right GPU for your workload. Scale up when you need more.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "12px",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            {GPU_LINEUP.map((gpu) => (
              <div
                key={gpu.name}
                style={{
                  background: "var(--panel)",
                  borderRadius: "14px",
                  padding: "24px 20px",
                  border: gpu.highlight
                    ? "2px solid var(--blue)"
                    : "1px solid var(--line)",
                  textAlign: "center",
                  position: "relative",
                  opacity: gpu.available ? 1 : 0.55,
                }}
              >
                {gpu.highlight && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-10px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      padding: "3px 10px",
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: "var(--blue)",
                      color: "#fff",
                      borderRadius: "6px",
                    }}
                  >
                    Best Value
                  </div>
                )}
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    color: "var(--muted)",
                    marginBottom: "8px",
                  }}
                >
                  {gpu.arch}
                </div>
                <h3
                  className="display"
                  style={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    margin: "0 0 4px",
                    color: gpu.highlight ? "var(--blue)" : "var(--ink)",
                  }}
                >
                  {gpu.name}
                </h3>
                <div style={{ fontSize: "14px", color: "var(--muted)", marginBottom: "12px" }}>
                  {gpu.vram} {gpu.type}
                </div>
                <div
                  className="display"
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    color: gpu.highlight ? "var(--blue)" : "var(--ink)",
                    marginBottom: "4px",
                  }}
                >
                  {gpu.price}
                  <span
                    style={{ fontSize: "12px", fontWeight: 500, color: "var(--muted)" }}
                  >
                    /hr
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: gpu.available ? "#16a34a" : "var(--muted)", fontWeight: 500 }}>
                  {gpu.available ? "Available Now" : "Sold Out"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section style={{ padding: "40px 0 80px" }}>
        <div className="container">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "24px",
              maxWidth: "700px",
              margin: "0 auto",
              textAlign: "center",
            }}
          >
            <div>
              <div
                className="display"
                style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: "4px" }}
              >
                EU &amp; US
              </div>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                Datacenter regions
              </div>
            </div>
            <div>
              <div
                className="display"
                style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: "4px" }}
              >
                99.9%
              </div>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                Uptime SLA
              </div>
            </div>
            <div>
              <div
                className="display"
                style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: "4px" }}
              >
                &lt;5 min
              </div>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                Deploy time
              </div>
            </div>
            <div>
              <div
                className="display"
                style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: "4px" }}
              >
                24/7
              </div>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                Engineering support
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "0 0 80px" }}>
        <div className="cta-section">
          <h2
            className="display"
            style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)" }}
          >
            Ready to run production AI?
          </h2>
          <p
            style={{
              color: "var(--muted)",
              maxWidth: "460px",
              margin: "16px auto 24px",
            }}
          >
            Get an RTX PRO 6000 in minutes. 96GB Blackwell at $0.66/hour. No
            contracts, no cluster minimums.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <Link href="/account" className="btn primary">
              Deploy Now
            </Link>
            <Link href="/contact" className="btn ghost">
              Talk to an Engineer
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
