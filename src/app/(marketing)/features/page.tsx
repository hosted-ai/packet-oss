import Link from "next/link";
import { Metadata } from "next";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Features - SSH Access, Monitoring, HuggingFace & More",
  description:
    "Full-featured GPU cloud: raw SSH, real-time monitoring, HuggingFace 1-click deploy, REST API, and persistent storage. Setup in under 5 minutes.",
  alternates: {
    canonical: "https://example.com/features",
  },
};

const GPUS = [
  {
    name: "NVIDIA B200",
    arch: "Blackwell",
    vram: "180GB",
    memType: "HBM3e",
    color: "#1a4fff",
    bg: "rgba(26, 79, 255, 0.08)",
    featured: true,
    tags: ["2.5x faster than H100", "70B+ models", "Production inference"],
  },
  {
    name: "NVIDIA H200",
    arch: "Hopper",
    vram: "141GB",
    memType: "HBM3",
    color: "#18b6a8",
    bg: "rgba(24, 182, 168, 0.08)",
    featured: false,
    tags: ["Large context windows", "FP8 acceleration", "Proven reliability"],
  },
  {
    name: "RTX PRO 6000",
    arch: "Blackwell",
    vram: "96GB",
    memType: "GDDR7 ECC",
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.08)",
    featured: false,
    tags: ["Cost-effective", "7B-70B models", "Dev & production"],
  },
];

const FAQS = [
  { q: "What GPU models does GPU Cloud offer?", a: "GPU Cloud offers NVIDIA B200 (180GB HBM3e), H200 (141GB HBM3e), and RTX PRO 6000 (96GB GDDR7 ECC) GPUs. The RTX PRO 6000 starts at $0.66/hr and is available for immediate deployment." },
  { q: "How fast can I deploy a GPU on GPU Cloud?", a: "You can go from signup to SSH access in under 5 minutes. All instances come with CUDA, Python, and ML libraries pre-installed." },
  { q: "Does GPU Cloud offer an SLA?", a: "Yes. All customers get a 99.9% uptime SLA with 24/7 support from our team of 40+ engineers. No enterprise tier required." },
  { q: "What deployment options are available?", a: "You can deploy via raw SSH with full root access, use our browser-based web terminal, or deploy HuggingFace models with one click." },
  { q: "Where are GPU Cloud servers located?", a: "Our GPUs are hosted in US data centers with enterprise-grade security and 99.9% uptime SLA." },
];

export default function FeaturesPage() {
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
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Features", href: "/features" }]} />
      {/* Hero */}
      <section className="hero" style={{ paddingTop: "100px", paddingBottom: "40px" }}>
        <div className="container">
          <div style={{ maxWidth: "720px", margin: "0 auto", textAlign: "center" }}>
            <div
              className="pill"
              style={{ marginBottom: "24px", marginLeft: "auto", marginRight: "auto" }}
            >
              Platform Features
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
              Everything to{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, var(--blue), var(--teal))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                ship AI products
              </span>
            </h1>
            <p
              style={{
                fontSize: "1.15rem",
                color: "var(--muted)",
                lineHeight: 1.7,
                maxWidth: "520px",
                margin: "0 auto 32px",
              }}
            >
              From signup to SSH in under 5 minutes. Latest NVIDIA GPUs, full root
              access, real-time monitoring, and transparent billing.
            </p>
            <div className="cta-row" style={{ justifyContent: "center" }}>
              <Link href="/#pricing" className="btn primary">
                Get Started
              </Link>
              <Link href="/contact" className="btn ghost">
                Talk to Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
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
              { value: "<5 min", label: "Signup to SSH" },
              { value: "180GB", label: "Max VRAM" },
              { value: "99.9%", label: "Uptime SLA" },
              { value: "24/7", label: "Engineer support" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                style={{
                  flex: "1 1 140px",
                  padding: "28px 24px",
                  textAlign: "center",
                  borderLeft: i > 0 ? "1px solid var(--line)" : "none",
                }}
              >
                <div
                  className="display"
                  style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "4px" }}
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

      {/* GPU Hardware */}
      <section
        id="hardware"
        style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}
      >
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Latest-Generation NVIDIA GPUs
            </h2>
            <p>The most powerful AI hardware, available on-demand.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {GPUS.map((gpu) => (
              <div
                key={gpu.name}
                style={{
                  background: "var(--panel)",
                  borderRadius: "16px",
                  padding: "28px",
                  border: gpu.featured
                    ? `2px solid ${gpu.color}`
                    : "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h3
                    className="display"
                    style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}
                  >
                    {gpu.name}
                  </h3>
                  <span
                    style={{
                      padding: "3px 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: gpu.color,
                      background: gpu.bg,
                      borderRadius: "6px",
                    }}
                  >
                    {gpu.arch}
                  </span>
                </div>
                <div>
                  <div
                    className="display"
                    style={{ fontSize: "2.2rem", fontWeight: 700, lineHeight: 1 }}
                  >
                    {gpu.vram}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "4px" }}>
                    {gpu.memType}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    marginTop: "auto",
                    paddingTop: "4px",
                  }}
                >
                  {gpu.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: "5px 10px",
                        fontSize: "12px",
                        color: "var(--muted)",
                        background: "rgba(0,0,0,0.03)",
                        borderRadius: "6px",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Access Methods - Terminal + Cards */}
      <section id="deployment" style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Deploy Your Way
            </h2>
            <p>SSH directly, use our web terminal, or deploy with one click.</p>
          </div>

          {/* Terminal block */}
          <div
            style={{
              background: "#0b0f1c",
              borderRadius: "16px",
              padding: "28px 32px",
              marginBottom: "20px",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "6px",
                marginBottom: "20px",
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
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
              <code>
                <span style={{ color: "#6b7280" }}>{"# Connect to your GPU instance"}</span>
                {"\n"}
                <span style={{ color: "#18b6a8" }}>$</span>{" "}
                {`ssh root@gpu-b200-01.the platform`}
                {"\n\n"}
                <span style={{ color: "#6b7280" }}>
                  {"# CUDA, Python, and drivers are pre-installed"}
                </span>
                {"\n"}
                <span style={{ color: "#18b6a8" }}>$</span> nvidia-smi{"\n"}
                <span style={{ color: "#6b7280" }}>
                  {"  NVIDIA B200 | 180GB HBM3e | CUDA 12.8"}
                </span>
                {"\n\n"}
                <span style={{ color: "#6b7280" }}>
                  {"# Deploy a HuggingFace model in one command"}
                </span>
                {"\n"}
                <span style={{ color: "#18b6a8" }}>$</span>{" "}
                {`vllm serve meta-llama/Llama-3.1-70B-Instruct`}
              </code>
            </pre>
          </div>

          {/* Method cards - 4 compact cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
            }}
          >
            {[
              {
                label: "Raw SSH",
                desc: "Full root access with your SSH key. Ubuntu, CUDA, your stack.",
                color: "#1a4fff",
              },
              {
                label: "Web Terminal",
                desc: "Browser-based terminal. No client needed, works from any device.",
                color: "#18b6a8",
              },
              {
                label: "HuggingFace",
                desc: "One-click model deploy. Auto memory calc, vLLM optimized serving.",
                color: "#8b5cf6",
              },
              {
                label: "REST API",
                desc: "Full API access. Launch, manage, and monitor GPUs programmatically.",
                color: "#f97316",
                link: "/docs/api-reference",
              },
            ].map((method) => (
              <div
                key={method.label}
                style={{
                  background: "var(--panel)",
                  borderRadius: "12px",
                  padding: "20px",
                  border: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "10px",
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: method.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    className="display"
                    style={{ fontSize: "15px", fontWeight: 700 }}
                  >
                    {method.label}
                  </span>
                </div>
                <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
                  {method.desc}
                </p>
                {method.link && (
                  <Link
                    href={method.link}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      marginTop: "10px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: method.color,
                    }}
                  >
                    Learn more
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Monitoring - Left text / Right visual */}
      <section
        id="dashboard"
        style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}
      >
        <div className="container">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "48px",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--blue)",
                  marginBottom: "12px",
                }}
              >
                Monitoring
              </div>
              <h2
                className="display"
                style={{
                  fontSize: "clamp(1.6rem, 2.5vw, 2rem)",
                  margin: "0 0 16px",
                }}
              >
                Real-time GPU metrics
              </h2>
              <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: "24px" }}>
                Live utilization, VRAM, temperature, and power draw for every
                instance. See system stats, billing, and activity logs from one
                dashboard.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[
                  "GPU utilization",
                  "VRAM tracking",
                  "Temperature",
                  "Power draw",
                  "CPU & RAM",
                ].map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      color: "var(--muted)",
                      background: "var(--panel)",
                      borderRadius: "6px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Mock metrics panel */}
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "16px",
                padding: "24px",
                border: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {[
                { label: "GPU Utilization", value: "87%", pct: 87, color: "var(--blue)" },
                { label: "VRAM", value: "142 / 180 GB", pct: 79, color: "var(--teal)" },
                { label: "Power", value: "420W / 700W", pct: 60, color: "#8b5cf6" },
              ].map((metric) => (
                <div key={metric.label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: "8px",
                    }}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 500 }}>
                      {metric.label}
                    </span>
                    <span
                      className="display"
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        color: metric.color,
                      }}
                    >
                      {metric.value}
                    </span>
                  </div>
                  <div
                    style={{
                      height: "6px",
                      background: "rgba(0,0,0,0.05)",
                      borderRadius: "3px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${metric.pct}%`,
                        height: "100%",
                        background: `linear-gradient(90deg, ${metric.color}, ${metric.color}dd)`,
                        borderRadius: "3px",
                      }}
                    />
                  </div>
                </div>
              ))}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginTop: "4px",
                }}
              >
                <div
                  style={{
                    padding: "12px",
                    background: "rgba(0,0,0,0.02)",
                    borderRadius: "10px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "2px" }}>
                    Temperature
                  </div>
                  <div className="display" style={{ fontSize: "18px", fontWeight: 600 }}>
                    68 C
                  </div>
                </div>
                <div
                  style={{
                    padding: "12px",
                    background: "rgba(0,0,0,0.02)",
                    borderRadius: "10px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "2px" }}>
                    Uptime
                  </div>
                  <div className="display" style={{ fontSize: "18px", fontWeight: 600 }}>
                    14d 6h
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Storage & Developer Tools - Bento grid */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Built for Developers
            </h2>
            <p>Persistent storage, pre-installed toolchains, and everything you need to ship fast.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: "12px",
            }}
          >
            {/* Row 1 - 3 cards spanning 2 cols each */}
            {[
              {
                title: "Persistent Storage",
                desc: "Your data survives reboots. Stop pods, resume later with all files intact. Only pay storage while stopped.",
                span: 2,
              },
              {
                title: "NVMe SSDs",
                desc: "High-speed storage for lightning-fast model loading and checkpoint saves.",
                span: 2,
              },
              {
                title: "Shared Volumes",
                desc: "Attach persistent volumes to any instance. Store models and datasets separately.",
                span: 2,
              },
              {
                title: "Pre-installed CUDA",
                desc: "Latest drivers and CUDA toolkit ready to go.",
                span: 2,
              },
              {
                title: "Python & ML Libraries",
                desc: "PyTorch, TensorFlow, and common ML tools pre-configured.",
                span: 2,
              },
              {
                title: "Docker Support",
                desc: "Run containerized workloads with full GPU passthrough.",
                span: 2,
              },
              {
                title: "Jupyter Ready",
                desc: "Start notebooks instantly for interactive development.",
                span: 2,
              },
              {
                title: "vLLM Optimized",
                desc: "High-performance inference with OpenAI-compatible API.",
                span: 2,
              },
              {
                title: "SSH Key Management",
                desc: "Manage multiple keys. Auto-inject into new instances.",
                span: 2,
              },
            ].map((card) => (
              <div
                key={card.title}
                style={{
                  gridColumn: `span ${card.span}`,
                  background: "var(--panel)",
                  borderRadius: "12px",
                  padding: "20px",
                  border: "1px solid var(--line)",
                }}
              >
                <h3
                  className="display"
                  style={{ fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}
                >
                  {card.title}
                </h3>
                <p
                  style={{
                    fontSize: "13px",
                    color: "var(--muted)",
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Billing - Dark pricing panel + Feature pills */}
      <section
        id="billing"
        style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}
      >
        <div className="container">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "24px",
              alignItems: "start",
            }}
          >
            {/* Dark pricing card */}
            <div
              style={{
                background: "linear-gradient(135deg, var(--ink), #1e293b)",
                borderRadius: "20px",
                padding: "36px",
                color: "#fff",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  opacity: 0.6,
                  marginBottom: "12px",
                }}
              >
                Starting at
              </div>
              <div
                className="display"
                style={{ fontSize: "3rem", fontWeight: 700, marginBottom: "8px" }}
              >
                $0.66
                <span style={{ fontSize: "1.1rem", fontWeight: 400, opacity: 0.5 }}>
                  /hr
                </span>
              </div>
              <div style={{ fontSize: "14px", opacity: 0.7, marginBottom: "28px" }}>
                NVIDIA RTX 6000 Pro with 96GB VRAM
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  marginBottom: "28px",
                }}
              >
                {["No contracts", "No minimums", "Cancel anytime", "No hidden fees"].map(
                  (item) => (
                    <div
                      key={item}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "14px",
                        opacity: 0.85,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{ color: "var(--teal)" }}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {item}
                    </div>
                  )
                )}
              </div>
              <Link
                href="/#pricing"
                className="btn"
                style={{
                  background: "#fff",
                  color: "var(--ink)",
                  width: "100%",
                  justifyContent: "center",
                }}
              >
                View All Pricing
              </Link>
            </div>

            {/* Billing features */}
            <div>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--blue)",
                  marginBottom: "12px",
                }}
              >
                Billing
              </div>
              <h2
                className="display"
                style={{
                  fontSize: "clamp(1.6rem, 2.5vw, 2rem)",
                  margin: "0 0 16px",
                }}
              >
                Transparent, fair pricing
              </h2>
              <p
                style={{
                  color: "var(--muted)",
                  lineHeight: 1.7,
                  marginBottom: "24px",
                }}
              >
                Pay for what you use. Prepaid wallet with real-time tracking, auto-refill,
                and early termination credits. No surprises.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                }}
              >
                {[
                  { title: "Hourly billing", desc: "No minimums" },
                  { title: "Prepaid wallet", desc: "Low balance alerts" },
                  { title: "Auto-refill", desc: "Never interrupt work" },
                  { title: "Early term credits", desc: "Unused time refunded" },
                  { title: "Real-time tracking", desc: "See spend as you go" },
                  { title: "Invoice history", desc: "Download for accounting" },
                ].map((item) => (
                  <div
                    key={item.title}
                    style={{
                      padding: "14px",
                      background: "var(--panel)",
                      borderRadius: "10px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "2px" }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      {item.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security - Badge/pill layout */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--blue)",
                marginBottom: "12px",
              }}
            >
              Security
            </div>
            <h2
              className="display"
              style={{
                fontSize: "clamp(1.6rem, 2.5vw, 2rem)",
                margin: "0 0 12px",
              }}
            >
              Enterprise-grade infrastructure
            </h2>
            <p
              style={{
                color: "var(--muted)",
                marginBottom: "32px",
                lineHeight: 1.7,
              }}
            >
              Isolated instances, encrypted storage, and enterprise-grade data centers.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                justifyContent: "center",
              }}
            >
              {[
                "Isolated containers",
                "AES-256 encryption",
                "TLS 1.3",
                "99.9% SLA",
                "US data centers",
                "Enterprise security",
                "24/7 monitoring",
                "SOC 2 aligned",
              ].map((badge) => (
                <span
                  key={badge}
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--ink)",
                    background: "var(--panel)",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Support - Minimal centered */}
      <section style={{ padding: "48px 0 80px" }}>
        <div className="container">
          <div
            style={{
              maxWidth: "520px",
              margin: "0 auto",
              textAlign: "center",
              padding: "40px",
              background: "linear-gradient(135deg, rgba(26, 79, 255, 0.06), rgba(24, 182, 168, 0.06))",
              borderRadius: "20px",
            }}
          >
            <h3
              className="display"
              style={{
                fontSize: "1.4rem",
                marginBottom: "10px",
              }}
            >
              Real humans, fast response
            </h3>
            <p
              style={{
                color: "var(--muted)",
                marginBottom: "20px",
                fontSize: "14px",
                lineHeight: 1.7,
              }}
            >
              No chatbots, no ticket queues. Talk directly to infrastructure
              engineers. 24/7 support with typical response in minutes.
            </p>
            <Link href="/contact" className="btn primary">
              Contact Support
            </Link>
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
            Ready to get started?
          </h2>
          <p
            style={{
              color: "var(--muted)",
              maxWidth: "460px",
              margin: "16px auto 24px",
            }}
          >
            Launch a GPU in minutes. No credit card required to explore.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <Link href="/#pricing" className="btn primary">
              Launch Your First GPU
            </Link>
            <Link href="/contact" className="btn ghost">
              Book a Demo
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
