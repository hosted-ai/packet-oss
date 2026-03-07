import { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "About Us - The Team Behind GPU Cloud",
  description: "GPU Cloud makes GPU computing accessible to every developer. Built by infrastructure veterans with decades of experience.",
  alternates: {
    canonical: "https://example.com/about",
  },
};

export default function AboutPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "About", href: "/about" }]} />
      {/* Hero */}
      <section className="hero" style={{ paddingTop: "60px", paddingBottom: "60px" }}>
        <div className="container">
          <div style={{ maxWidth: "720px", margin: "0 auto", textAlign: "center" }}>
            <span className="label">About Us</span>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem, 4vw, 3.2rem)", marginTop: "16px", marginBottom: "20px" }}>
              Making GPU Computing<br />Accessible to Everyone
            </h1>
            <p style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1.6 }}>
              Built by infrastructure veterans on a mission to democratize
              access to high-performance computing.
            </p>
          </div>
        </div>
      </section>

      {/* Our Mission Section */}
      <section style={{ padding: "60px 0" }}>
        <div className="container">
          <div className="about-grid">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ color: "var(--blue)" }}>
                  <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <div>
                  <h2 className="display" style={{ fontSize: "1.5rem", margin: 0 }}>
                    Our Mission
                  </h2>
                  <span style={{ color: "var(--muted)", fontSize: "14px" }}>The company behind the platform</span>
                </div>
              </div>

              <p style={{ color: "var(--ink)", fontSize: "17px", lineHeight: 1.7, marginBottom: "16px" }}>
                We are an infrastructure company focused on making cloud computing more accessible,
                efficient, and developer-friendly. We believe powerful computing resources shouldn&apos;t be
                locked behind complex setups or enterprise contracts.
              </p>

              <p style={{ color: "var(--muted)", fontSize: "16px", lineHeight: 1.7, marginBottom: "16px" }}>
                This platform is our flagship product for GPU computing &mdash; designed specifically for
                developers who need powerful hardware without the traditional cloud overhead. Whether
                you&apos;re training ML models, running inference, or building AI applications, we provide
                the infrastructure that just works.
              </p>

              <p style={{ color: "var(--muted)", fontSize: "16px", lineHeight: 1.7, marginBottom: "24px" }}>
                Our team combines deep expertise in cloud infrastructure, distributed systems, and
                developer tools. We&apos;ve built and scaled systems at companies of all sizes, and we&apos;re
                applying that experience to make GPU computing accessible to everyone.
              </p>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <Link href="/contact" className="btn primary">
                  Contact Us
                </Link>
              </div>
            </div>

            <div>
              <div style={{
                background: "linear-gradient(135deg, rgba(26, 79, 255, 0.08), rgba(24, 182, 168, 0.08))",
                borderRadius: "20px",
                padding: "32px",
                border: "1px solid var(--line)"
              }}>
                <h3 className="display" style={{ fontSize: "1.2rem", marginBottom: "24px" }}>What We Stand For</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: "var(--blue)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Speed</strong>
                      <span style={{ color: "var(--muted)", fontSize: "14px" }}>
                        From signup to running GPU in under 60 seconds
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: "var(--teal)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Simplicity</strong>
                      <span style={{ color: "var(--muted)", fontSize: "14px" }}>
                        No PhD in cloud infrastructure required
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: "var(--ink)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Fair Pricing</strong>
                      <span style={{ color: "var(--muted)", fontSize: "14px" }}>
                        Pay for compute, not idle time
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: "linear-gradient(135deg, var(--blue), var(--teal))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" strokeLinecap="round"/>
                        <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" strokeLinecap="round"/>
                        <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Developer Joy</strong>
                      <span style={{ color: "var(--muted)", fontSize: "14px" }}>
                        Built by developers, for developers
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Team */}
      <section style={{ padding: "60px 0", background: "var(--panel)" }}>
        <div className="container">
          <div style={{ textAlign: "center", maxWidth: "600px", margin: "0 auto 40px" }}>
            <h2 className="display" style={{ fontSize: "1.8rem", marginBottom: "16px" }}>Our Team</h2>
            <p style={{ color: "var(--muted)", fontSize: "16px", lineHeight: 1.6 }}>
              Our team brings decades of experience in cloud infrastructure, distributed systems, and developer tools.
            </p>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "20px",
            maxWidth: "960px",
            margin: "0 auto"
          }}>
            {/* Add your team members here. Example:
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "24px",
                textAlign: "center",
              }}
              className="team-member"
            >
              <div style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--blue), var(--teal))",
                margin: "0 auto 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                fontWeight: 600,
                color: "white"
              }}>
                JD
              </div>
              <h3 style={{ marginBottom: "4px", color: "var(--ink)", fontSize: "16px" }}>Jane Doe</h3>
              <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "12px" }}>Co-founder</p>
            </div>
            */}
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "24px",
                textAlign: "center",
              }}
            >
              <p style={{ color: "var(--muted)", fontSize: "14px" }}>
                Customize this section with your team members.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Company Info */}
      <section style={{ padding: "60px 0" }}>
        <div className="container">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "24px",
            maxWidth: "900px",
            margin: "0 auto"
          }}>
            <div style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "16px",
              padding: "28px",
              textAlign: "center"
            }}>
              <div style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--teal), var(--blue))",
                margin: "0 auto 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 style={{ marginBottom: "8px" }}>Growing Team</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: 1.6 }}>
                A focused team of engineers and infrastructure experts building
                the future of cloud computing.
              </p>
            </div>

            <div style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "16px",
              padding: "28px",
              textAlign: "center"
            }}>
              <div style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--ink), var(--blue))",
                margin: "0 auto 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 style={{ marginBottom: "8px" }}>Developer First</h3>
              <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: 1.6 }}>
                Every feature on this platform is designed with developer experience in mind.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section style={{ padding: "80px 0" }}>
        <div className="container">
          <div className="cta-section" style={{ margin: 0 }}>
            <h2 className="display" style={{ marginBottom: "16px" }}>Let&apos;s Talk</h2>
            <p style={{ maxWidth: "480px", margin: "0 auto 24px" }}>
              Have questions? Want to discuss enterprise solutions?
              Or just want to chat about GPUs? We&apos;d love to hear from you.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/contact" className="btn primary">
                Contact Us
              </Link>
              <a href="mailto:hello@example.com" className="btn ghost">
                hello@example.com
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
