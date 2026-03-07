"use client";

import Link from "next/link";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export interface CompetitorData {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  /** Competitor's GPU pricing for comparison */
  pricing: {
    gpu: string;
    competitorPrice: number | string;
    packetPrice: number;
    savings: string;
  }[];
  /** Feature comparison grid */
  features: {
    label: string;
    packet: string | boolean;
    competitor: string | boolean;
  }[];
  /** Why switch reasons */
  reasons: {
    title: string;
    description: string;
    icon: string;
  }[];
  /** FAQ entries */
  faqs: {
    q: string;
    a: string;
  }[];
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FeatureCell({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? <CheckIcon /> : <XIcon />;
  }
  return <span>{value}</span>;
}

export default function ComparisonPage({ data }: { data: CompetitorData }) {
  return (
    <>
      <BreadcrumbJsonLd items={[
        { name: "Home", href: "/" },
        { name: "Compare", href: "/vs" },
        { name: `GPU Cloud vs ${data.name}`, href: `/vs/${data.slug}` },
      ]} />
      {/* Hero Section */}
      <section style={{
        padding: "100px 0 60px",
        background: "linear-gradient(180deg, #0a0a0a 0%, #111827 100%)",
        color: "white",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Background gradient orbs */}
        <div style={{
          position: "absolute",
          top: "-150px",
          right: "-100px",
          width: "500px",
          height: "500px",
          background: "radial-gradient(circle, rgba(26, 79, 255, 0.15) 0%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(60px)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute",
          bottom: "-100px",
          left: "-50px",
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(24, 182, 168, 0.1) 0%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(40px)",
          pointerEvents: "none",
        }} />

        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div style={{ maxWidth: "800px", margin: "0 auto", textAlign: "center" }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(26, 79, 255, 0.1)",
              border: "1px solid rgba(26, 79, 255, 0.3)",
              borderRadius: "100px",
              padding: "6px 16px",
              marginBottom: "24px",
              fontSize: "14px",
              color: "#93c5fd",
            }}>
              GPU Cloud Comparison
            </div>

            <h1 style={{
              fontSize: "clamp(2.2rem, 5vw, 3.5rem)",
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: "20px",
              fontFamily: "var(--font-display)",
            }}>
              GPU Cloud vs {data.name}
            </h1>

            <p style={{
              fontSize: "20px",
              color: "rgba(255,255,255,0.7)",
              marginBottom: "12px",
              lineHeight: 1.6,
              maxWidth: "600px",
              margin: "0 auto 32px",
            }}>
              {data.tagline}
            </p>

            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link
                href="/account"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "linear-gradient(135deg, #1a4fff, #1238c9)",
                  color: "white",
                  padding: "14px 32px",
                  borderRadius: "8px",
                  fontSize: "16px",
                  fontWeight: 600,
                  textDecoration: "none",
                  boxShadow: "0 4px 20px rgba(26, 79, 255, 0.3)",
                }}
              >
                Try GPU Cloud Free
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link
                href="/#pricing"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "rgba(255,255,255,0.1)",
                  color: "white",
                  padding: "14px 32px",
                  borderRadius: "8px",
                  fontSize: "16px",
                  fontWeight: 500,
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Comparison Table */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
              Price comparison
            </h2>
            <p style={{ color: "var(--muted)", fontSize: "18px" }}>
              Real pricing data from public sources. Updated February 2026.
            </p>
          </div>

          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            <div style={{
              background: "white",
              borderRadius: "16px",
              border: "1px solid var(--line)",
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
            }}>
              {/* Table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1fr 1fr 0.8fr",
                padding: "16px 24px",
                background: "#f8fafc",
                borderBottom: "1px solid var(--line)",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
              }}>
                <div>GPU Model</div>
                <div>{data.name}</div>
                <div style={{ color: "var(--blue)" }}>GPU Cloud</div>
                <div>Savings</div>
              </div>

              {/* Table rows */}
              {data.pricing.map((row, i) => (
                <div key={row.gpu} style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 1fr 1fr 0.8fr",
                  padding: "18px 24px",
                  borderBottom: i < data.pricing.length - 1 ? "1px solid #f1f5f9" : "none",
                  alignItems: "center",
                  fontSize: "15px",
                }}>
                  <div style={{ fontWeight: 600 }}>{row.gpu}</div>
                  <div style={{ color: "var(--muted)" }}>
                    {typeof row.competitorPrice === "number" ? `$${row.competitorPrice.toFixed(2)}/hr` : row.competitorPrice}
                  </div>
                  <div style={{ fontWeight: 700, color: "var(--blue)" }}>
                    ${row.packetPrice.toFixed(2)}/hr
                  </div>
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 10px",
                    borderRadius: "100px",
                    background: "#f0fdf4",
                    color: "#16a34a",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}>
                    {row.savings}
                  </div>
                </div>
              ))}
            </div>

            <p style={{ textAlign: "center", fontSize: "13px", color: "var(--muted)", marginTop: "16px" }}>
              Prices are on-demand per-GPU hourly rates from{" "}
              <a href="https://getdeploying.com/gpus" target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)" }}>
                getdeploying.com
              </a>{" "}
              and provider websites. Last verified Feb 2026.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Comparison */}
      <section style={{ padding: "80px 0", background: "var(--panel)" }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
              Feature comparison
            </h2>
            <p style={{ color: "var(--muted)", fontSize: "18px" }}>
              See how GPU Cloud stacks up across the board.
            </p>
          </div>

          <div style={{ maxWidth: "700px", margin: "0 auto" }}>
            <div style={{
              background: "white",
              borderRadius: "16px",
              border: "1px solid var(--line)",
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
            }}>
              {/* Header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr",
                padding: "16px 24px",
                background: "#f8fafc",
                borderBottom: "1px solid var(--line)",
                fontSize: "13px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
              }}>
                <div>Feature</div>
                <div style={{ textAlign: "center", color: "var(--blue)" }}>GPU Cloud</div>
                <div style={{ textAlign: "center" }}>{data.name}</div>
              </div>

              {/* Rows */}
              {data.features.map((row, i) => (
                <div key={row.label} style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr",
                  padding: "16px 24px",
                  borderBottom: i < data.features.length - 1 ? "1px solid #f1f5f9" : "none",
                  fontSize: "14px",
                  alignItems: "center",
                }}>
                  <div style={{ fontWeight: 500 }}>{row.label}</div>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <FeatureCell value={row.packet} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <FeatureCell value={row.competitor} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Switch */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
              Why teams switch to GPU Cloud
            </h2>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "24px",
            maxWidth: "900px",
            margin: "0 auto",
          }}>
            {data.reasons.map((reason) => (
              <div key={reason.title} style={{
                background: "white",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "32px",
              }}>
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, rgba(26, 79, 255, 0.08), rgba(24, 182, 168, 0.08))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "20px",
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.5">
                    <path d={reason.icon} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px", fontFamily: "var(--font-display)" }}>
                  {reason.title}
                </h3>
                <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: 1.6 }}>
                  {reason.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section style={{ padding: "60px 0", background: "#f8fafc" }}>
        <div className="container">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "32px",
            maxWidth: "900px",
            margin: "0 auto",
            textAlign: "center",
          }}>
            {[
              { value: "40+", label: "Engineers on the team" },
              { value: "99.9%", label: "Uptime SLA guaranteed" },
              { value: "24/7", label: "Support for all customers" },
              { value: "30yr", label: "Infrastructure experience" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="display" style={{ fontSize: "32px", fontWeight: 700, color: "var(--blue)", marginBottom: "4px" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: "14px", color: "var(--muted)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
          <p style={{
            textAlign: "center",
            fontSize: "14px",
            color: "var(--muted)",
            marginTop: "32px",
            maxWidth: "600px",
            margin: "32px auto 0",
            lineHeight: 1.6,
          }}>
            Built by infrastructure veterans with decades of experience building cloud computing platforms.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "80px 0", background: "var(--panel)" }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
              Frequently asked questions
            </h2>
          </div>

          <div style={{ maxWidth: "700px", margin: "0 auto" }}>
            {data.faqs.map((faq, i) => (
              <details key={i} style={{
                borderBottom: "1px solid var(--line)",
                padding: "20px 0",
              }}>
                <summary style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  listStyle: "none",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: "var(--font-display)",
                }}>
                  {faq.q}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" style={{ flexShrink: 0, marginLeft: "16px" }}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <p style={{
                  color: "var(--muted)",
                  fontSize: "15px",
                  lineHeight: 1.7,
                  marginTop: "12px",
                  paddingRight: "36px",
                }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: "100px 0",
        background: "linear-gradient(180deg, #111827 0%, #0a0a0a 100%)",
        color: "white",
        textAlign: "center",
      }}>
        <div className="container">
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            <h2 style={{
              fontSize: "clamp(2rem, 4vw, 3rem)",
              fontWeight: 700,
              marginBottom: "16px",
              fontFamily: "var(--font-display)",
            }}>
              Ready to switch?
            </h2>
            <p style={{
              fontSize: "18px",
              color: "rgba(255,255,255,0.7)",
              marginBottom: "32px",
            }}>
              Deploy your first GPU in under 5 minutes. No credit card required.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link
                href="/account"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "linear-gradient(135deg, #1a4fff, #1238c9)",
                  color: "white",
                  padding: "16px 40px",
                  borderRadius: "8px",
                  fontSize: "18px",
                  fontWeight: 600,
                  textDecoration: "none",
                  boxShadow: "0 4px 20px rgba(26, 79, 255, 0.3)",
                }}
              >
                Start Free
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link
                href="/contact"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "16px 40px",
                  borderRadius: "8px",
                  fontSize: "18px",
                  fontWeight: 500,
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.3)",
                  color: "white",
                }}
              >
                Talk to Sales
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
