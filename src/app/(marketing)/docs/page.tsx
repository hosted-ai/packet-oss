import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation - Developer Guides & API Reference",
  description: "Complete developer documentation for GPU Cloud. Quick start guide, API reference, SSH access, HuggingFace deployment, and GPU monitoring.",
  alternates: {
    canonical: "https://example.com/docs",
  },
};

const docCategories = [
  {
    title: "Getting Started",
    description: "Start deploying GPU workloads in minutes",
    docs: [
      { title: "Quick Start Guide", href: "/docs/getting-started", description: "Deploy your first GPU in under 60 seconds" },
      { title: "CLI Documentation", href: "/cli", description: "GPU cloud from your terminal" },
      { title: "SSH Access", href: "/docs/ssh", description: "Connect to your GPU instances via SSH" },
      { title: "Hugging Face Deployment", href: "/docs/huggingface", description: "One-click model deployment from Hugging Face" },
    ],
  },
  {
    title: "API & Integration",
    description: "Integrate with your applications",
    docs: [

      { title: "REST API Reference", href: "/docs/api-reference", description: "Complete API docs with Swagger UI" },
      { title: "Inference Playground", href: "/docs/inference-playground", description: "Interactive chat interface for testing" },
      { title: "Browser IDEs", href: "/docs/browser-ide", description: "VS Code and Jupyter in your browser" },
    ],
  },
  {
    title: "Monitoring & Analytics",
    description: "Track performance and usage",
    docs: [
      { title: "GPU Metrics Dashboard", href: "/docs/gpu-metrics", description: "Real-time GPU monitoring and analytics" },
      { title: "Token Usage", href: "/docs/token-usage", description: "Track and analyze token consumption" },
    ],
  },
  {
    title: "Resources & Billing",
    description: "Manage resources and costs",
    docs: [
      { title: "Pro 6000 Blackwell Models", href: "/docs/blackwell", description: "Optimized models for 96GB GPUs" },
      { title: "Persistent Storage", href: "/docs/storage", description: "Attach and manage storage volumes" },
      { title: "Persistent Workspace", href: "/docs/workspace", description: "Persist your environment across restarts" },
      { title: "Budget Controls", href: "/docs/budget-controls", description: "Set spending limits and auto-shutdown" },
    ],
  },
  {
    title: "White-Label",
    description: "Launch your own GPU cloud brand",
    docs: [
      { title: "Service Provider Guide", href: "/docs/white-label", description: "Set up your white-label GPU platform" },
    ],
  },
];

export default function DocsIndexPage() {
  return (
    <>
      {/* Hero */}
      <section className="hero" style={{ paddingTop: "60px", paddingBottom: "40px" }}>
        <div className="container">
          <div style={{ maxWidth: "720px", margin: "0 auto", textAlign: "center" }}>
            <span className="label">Documentation</span>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem, 4vw, 3.2rem)", marginTop: "16px", marginBottom: "20px" }}>
              Developer Docs
            </h1>
            <p style={{ fontSize: "18px", color: "var(--muted)", lineHeight: 1.6 }}>
              Everything you need to deploy and scale AI models on the platform&apos;s GPU cloud.
            </p>
          </div>
        </div>
      </section>

      {/* Featured: Getting Started */}
      <section style={{ padding: "20px 0 60px" }}>
        <div className="container">
          <Link
            href="/docs/getting-started"
            style={{
              display: "block",
              background: "linear-gradient(135deg, rgba(26, 79, 255, 0.08), rgba(24, 182, 168, 0.08))",
              border: "1px solid var(--line)",
              borderRadius: "20px",
              padding: "32px",
              textDecoration: "none",
              maxWidth: "800px",
              margin: "0 auto",
              transition: "all 0.2s ease",
            }}
            className="featured-doc"
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "20px" }}>
              <div style={{
                width: "56px",
                height: "56px",
                borderRadius: "14px",
                background: "linear-gradient(135deg, var(--blue), var(--teal))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <h2 style={{ margin: 0, fontSize: "1.4rem", color: "var(--ink)" }}>Getting Started</h2>
                  <span style={{
                    background: "var(--teal)",
                    color: "white",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: "4px",
                    textTransform: "uppercase",
                  }}>Popular</span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: "15px", lineHeight: 1.6, margin: 0 }}>
                  Deploy your first GPU instance in under 60 seconds. Full root access, pre-installed CUDA,
                  and SSH connectivity out of the box.
                </p>
                <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", color: "var(--blue)", fontSize: "14px", fontWeight: 500 }}>
                  Read the docs
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Doc Categories - 2x2 Grid */}
      <section style={{ padding: "0 0 80px" }}>
        <div className="container">
          <div
            className="docs-grid-2x2"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "24px",
              maxWidth: "900px",
              margin: "0 auto",
            }}
          >
            {docCategories.map((category) => (
              <div
                key={category.title}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: "16px",
                  padding: "24px",
                }}
              >
                <h3 style={{ fontSize: "1.1rem", marginBottom: "4px", color: "var(--ink)" }}>{category.title}</h3>
                <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "20px" }}>{category.description}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {category.docs.map((doc) => (
                    <Link
                      key={doc.href}
                      href={doc.href}
                      style={{
                        display: "block",
                        padding: "12px",
                        background: "var(--bg)",
                        borderRadius: "10px",
                        textDecoration: "none",
                        transition: "background 0.2s ease",
                      }}
                      className="doc-link"
                    >
                      <div style={{ fontWeight: 500, color: "var(--ink)", fontSize: "14px", marginBottom: "2px" }}>
                        {doc.title}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: "12px" }}>{doc.description}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Help CTA */}
      <section style={{ padding: "60px 0", background: "var(--panel)" }}>
        <div className="container">
          <div style={{ textAlign: "center", maxWidth: "500px", margin: "0 auto" }}>
            <h2 className="display" style={{ fontSize: "1.6rem", marginBottom: "12px" }}>Need Help?</h2>
            <p style={{ color: "var(--muted)", fontSize: "15px", marginBottom: "24px" }}>
              Can&apos;t find what you&apos;re looking for? Our team is here to help.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/contact" className="btn primary">
                Contact Support
              </Link>
              <a href="mailto:support@example.com" className="btn ghost">
                support@example.com
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
