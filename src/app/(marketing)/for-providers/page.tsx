import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "For GPU Providers - Monetize Your Spare GPU Capacity",
  description:
    "Add your spare GPU capacity to GPU Cloud's marketplace. Automated go-to-market, bi-weekly payouts, real-time occupancy tracking, and zero integration overhead.",
  alternates: {
    canonical: "https://example.com/for-providers",
  },
};

const STATS = [
  { value: "87%", label: "Avg utilization" },
  { value: "$2.84", label: "Avg $/GPU/hr" },
  { value: "14 days", label: "Payout cycle" },
  { value: "99.5%", label: "Uptime SLA" },
];

const GPU_TIERS = [
  {
    name: "NVIDIA B200",
    arch: "Blackwell",
    vram: "180 GB HBM3e",
    tier: "Premium",
    color: "#1a4fff",
    bg: "rgba(26, 79, 255, 0.08)",
    rate: "Highest tier pricing",
    featured: true,
  },
  {
    name: "NVIDIA H200",
    arch: "Hopper",
    vram: "141 GB HBM3",
    tier: "Premium",
    color: "#18b6a8",
    bg: "rgba(24, 182, 168, 0.08)",
    rate: "Top tier pricing",
    featured: false,
  },
  {
    name: "NVIDIA H100",
    arch: "Hopper",
    vram: "80 GB HBM3",
    tier: "High",
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.08)",
    rate: "Competitive rates",
    featured: false,
  },
  {
    name: "NVIDIA A100 80GB",
    arch: "Ampere",
    vram: "80 GB HBM2e",
    tier: "Standard",
    color: "#f97316",
    bg: "rgba(249, 115, 22, 0.08)",
    rate: "Solid returns",
    featured: false,
  },
  {
    name: "RTX PRO 6000",
    arch: "Blackwell",
    vram: "96 GB GDDR7",
    tier: "Standard",
    color: "#ec4899",
    bg: "rgba(236, 72, 153, 0.08)",
    rate: "Cost-effective tier",
    featured: false,
  },
];

const STEPS = [
  {
    num: "01",
    title: "Apply",
    desc: "Submit your infrastructure details. We verify hardware specs, network quality, and hosting environment.",
    color: "#1a4fff",
  },
  {
    num: "02",
    title: "Connect",
    desc: "Install our lightweight provisioning agent. Your servers stay under your control with minimal overhead.",
    color: "#18b6a8",
  },
  {
    num: "03",
    title: "Earn",
    desc: "Your GPUs go live on our marketplace. Track occupancy and earnings in real-time through your dashboard.",
    color: "#8b5cf6",
  },
];

const BENEFITS = [
  {
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    title: "Zero Sales Overhead",
    desc: "No sales team needed. Your GPUs are instantly discoverable by thousands of AI developers worldwide.",
  },
  {
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    title: "Bi-Weekly Payouts",
    desc: "Predictable income every two weeks. We handle billing, invoicing, and payment collection.",
  },
  {
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    title: "Real-Time Transparency",
    desc: "Full visibility into occupancy, revenue per hour, and earnings breakdowns via your provider dashboard.",
  },
  {
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    title: "Scale Flexibly",
    desc: "Add 1 to hundreds of GPUs. Scale up or down based on your capacity. No long-term commitments.",
  },
  {
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    title: "Premium Customers",
    desc: "Verified businesses running production AI workloads. No crypto miners or abuse.",
  },
  {
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    title: "Simple Integration",
    desc: "Our lightweight agent handles provisioning and monitoring. Minimal overhead, maximum control.",
  },
];

const DASHBOARD_METRICS = [
  { label: "Monthly Revenue", value: "$12,450", change: "+18%", up: true },
  { label: "Avg Utilization", value: "87%", change: "+4%", up: true },
  { label: "Active GPUs", value: "24", change: "0", up: true },
  { label: "Uptime", value: "99.97%", change: "+0.02%", up: true },
];

const DASHBOARD_GPUS = [
  { name: "H100-01", util: 94, revenue: "$3.20/hr", status: "occupied" },
  { name: "H100-02", util: 88, revenue: "$3.20/hr", status: "occupied" },
  { name: "A100-01", util: 76, revenue: "$2.10/hr", status: "occupied" },
  { name: "A100-02", util: 0, revenue: "$0.00/hr", status: "available" },
  { name: "B200-01", util: 92, revenue: "$5.40/hr", status: "occupied" },
];

export default function ForProvidersPage() {
  return (
    <>
      {/* Hero */}
      <section className="hero" style={{ paddingTop: "100px", paddingBottom: "40px" }}>
        <div className="container">
          <div style={{ maxWidth: "720px", margin: "0 auto", textAlign: "center" }}>
            <div
              className="pill"
              style={{ marginBottom: "24px", marginLeft: "auto", marginRight: "auto" }}
            >
              For GPU Providers
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
              Turn idle GPUs into{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, var(--blue), var(--teal))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                recurring revenue
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
              Add your spare GPU capacity to our marketplace. We handle customer
              acquisition, billing, and support. You keep your hardware running.
            </p>
            <div className="cta-row" style={{ justifyContent: "center" }}>
              <Link href="/providers/apply" className="btn primary">
                Apply to Become a Provider
              </Link>
              <Link href="/providers" className="btn ghost">
                Provider Login
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
            {STATS.map((stat, i) => (
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

      {/* Why Partner */}
      <section style={{ padding: "0 0 80px" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              We handle the hard parts
            </h2>
            <p>Focus on keeping your hardware running. We do the rest.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "16px",
            }}
          >
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                style={{
                  background: "var(--panel)",
                  borderRadius: "14px",
                  padding: "28px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  gap: "16px",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    minWidth: "40px",
                    borderRadius: "10px",
                    background: "rgba(26, 79, 255, 0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--blue)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={b.icon} />
                  </svg>
                </div>
                <div>
                  <h3
                    className="display"
                    style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 6px" }}
                  >
                    {b.title}
                  </h3>
                  <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
                    {b.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - numbered steps */}
      <section
        style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}
      >
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Three steps to start earning
            </h2>
            <p>From application to revenue in under a week.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "24px",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            {STEPS.map((step) => (
              <div
                key={step.num}
                style={{
                  background: "var(--panel)",
                  borderRadius: "16px",
                  padding: "32px 28px",
                  border: "1px solid var(--line)",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    fontSize: "48px",
                    fontWeight: 800,
                    color: step.color,
                    opacity: 0.12,
                    position: "absolute",
                    top: "16px",
                    right: "20px",
                    lineHeight: 1,
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {step.num}
                </div>
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: step.color,
                    marginBottom: "16px",
                  }}
                />
                <h3
                  className="display"
                  style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0 0 10px" }}
                >
                  {step.title}
                </h3>
                <p style={{ fontSize: "14px", color: "var(--muted)", margin: 0, lineHeight: 1.65 }}>
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GPU Tiers */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Accepted GPU models
            </h2>
            <p>We accept high-performance NVIDIA GPUs suitable for AI/ML workloads.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "12px",
            }}
          >
            {GPU_TIERS.map((gpu) => (
              <div
                key={gpu.name}
                style={{
                  background: "var(--panel)",
                  borderRadius: "14px",
                  padding: "24px",
                  border: gpu.featured
                    ? `2px solid ${gpu.color}`
                    : "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--muted)",
                    }}
                  >
                    {gpu.arch}
                  </span>
                  <span
                    style={{
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: gpu.color,
                      background: gpu.bg,
                      borderRadius: "5px",
                    }}
                  >
                    {gpu.tier}
                  </span>
                </div>
                <h3
                  className="display"
                  style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}
                >
                  {gpu.name}
                </h3>
                <div style={{ fontSize: "13px", color: "var(--muted)" }}>{gpu.vram}</div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: gpu.color,
                    marginTop: "auto",
                    paddingTop: "4px",
                  }}
                >
                  {gpu.rate}
                </div>
              </div>
            ))}
          </div>

          {/* Requirements pills */}
          <div
            style={{
              marginTop: "32px",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {[
              "Stable network connectivity",
              "Enterprise-grade hosting",
              "Reliable power & cooling",
              "99%+ uptime capability",
            ].map((req) => (
              <span
                key={req}
                style={{
                  padding: "10px 16px",
                  fontSize: "13px",
                  color: "var(--muted)",
                  background: "var(--panel)",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                }}
              >
                {req}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Mock Dashboard */}
      <section
        style={{ padding: "80px 0", background: "rgba(26, 79, 255, 0.02)" }}
      >
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Your provider dashboard
            </h2>
            <p>Real-time visibility into your GPU fleet performance and earnings.</p>
          </div>

          {/* Dashboard mockup */}
          <div
            style={{
              background: "#0b0f1c",
              borderRadius: "16px",
              padding: "32px",
              border: "1px solid rgba(255,255,255,0.08)",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            {/* Top metrics row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "16px",
                marginBottom: "24px",
              }}
            >
              {DASHBOARD_METRICS.map((m) => (
                <div
                  key={m.label}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: "12px",
                    padding: "18px 16px",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      color: "rgba(255,255,255,0.4)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: "8px",
                    }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 700,
                        color: "#fff",
                        fontFamily: "var(--font-display)",
                      }}
                    >
                      {m.value}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: m.up ? "#18b6a8" : "#ef4444",
                      }}
                    >
                      {m.change}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* GPU fleet table */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.06)",
                overflow: "hidden",
              }}
            >
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 100px",
                  padding: "12px 16px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                }}
              >
                <span>GPU</span>
                <span>Utilization</span>
                <span>Revenue</span>
                <span>Status</span>
              </div>

              {/* Rows */}
              {DASHBOARD_GPUS.map((gpu) => (
                <div
                  key={gpu.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 100px",
                    padding: "14px 16px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#fff",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {gpu.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        flex: 1,
                        maxWidth: "100px",
                        height: "6px",
                        borderRadius: "3px",
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${gpu.util}%`,
                          height: "100%",
                          borderRadius: "3px",
                          background:
                            gpu.util > 80
                              ? "linear-gradient(90deg, #18b6a8, #1a4fff)"
                              : gpu.util > 0
                                ? "#f97316"
                                : "rgba(255,255,255,0.08)",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "rgba(255,255,255,0.5)",
                        minWidth: "30px",
                      }}
                    >
                      {gpu.util}%
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "rgba(255,255,255,0.6)",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {gpu.revenue}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "4px 10px",
                      borderRadius: "6px",
                      textAlign: "center",
                      background:
                        gpu.status === "occupied"
                          ? "rgba(24, 182, 168, 0.15)"
                          : "rgba(255,255,255,0.06)",
                      color:
                        gpu.status === "occupied"
                          ? "#18b6a8"
                          : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {gpu.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Payout preview */}
            <div
              style={{
                marginTop: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "rgba(26, 79, 255, 0.08)",
                borderRadius: "10px",
                padding: "14px 18px",
                border: "1px solid rgba(26, 79, 255, 0.15)",
              }}
            >
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)" }}>
                Next payout (Feb 28)
              </span>
              <span
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: "#fff",
                  fontFamily: "var(--font-display)",
                }}
              >
                $6,225.00
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Flexibility & Control */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="section-title" style={{ marginBottom: "48px" }}>
            <h2
              className="display"
              style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}
            >
              Your GPUs, your terms
            </h2>
            <p>Complete flexibility. No lock-in.</p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "16px",
              maxWidth: "800px",
              margin: "0 auto",
            }}
          >
            {/* Withdraw */}
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "14px",
                padding: "28px",
                border: "1px solid var(--line)",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#18b6a8",
                  marginBottom: "16px",
                }}
              />
              <h3
                className="display"
                style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 10px" }}
              >
                Withdraw anytime
              </h3>
              <p style={{ fontSize: "14px", color: "var(--muted)", margin: 0, lineHeight: 1.65 }}>
                Need your GPUs back? Withdraw capacity at any time. If currently
                occupied, we require 7 days notice for smooth workload migration.
              </p>
            </div>

            {/* No lock-in */}
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "14px",
                padding: "28px",
                border: "1px solid var(--line)",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#1a4fff",
                  marginBottom: "16px",
                }}
              />
              <h3
                className="display"
                style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 10px" }}
              >
                No contracts
              </h3>
              <p style={{ fontSize: "14px", color: "var(--muted)", margin: 0, lineHeight: 1.65 }}>
                No long-term contracts or commitments. Add capacity when you have
                it, withdraw when you need it. Complete flexibility.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "48px 0 80px" }}>
        <div className="cta-section">
          <h2
            className="display"
            style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)" }}
          >
            Ready to monetize your GPU capacity?
          </h2>
          <p
            style={{
              color: "var(--muted)",
              maxWidth: "460px",
              margin: "16px auto 24px",
            }}
          >
            Join our network of verified providers and start earning from your idle GPUs.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <Link href="/providers/apply" className="btn primary">
              Apply to Become a Provider
            </Link>
            <Link href="/contact" className="btn ghost">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
