"use client";

import Link from "next/link";
import { BudgetControlsDoc } from "@/app/dashboard/components/docs/BudgetControlsDoc";

export default function BudgetControlsDocsPage() {
  return (
    <>
      <section style={{ paddingTop: "40px", paddingBottom: "20px" }}>
        <div className="container">
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            <Link
              href="/docs"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                color: "var(--muted)",
                fontSize: "14px",
                textDecoration: "none",
                marginBottom: "20px",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back to Docs
            </Link>
            <h1 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", margin: "0 0 8px 0" }}>
              Budget Controls & Auto-Shutdown
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "16px" }}>
              Set spending limits, alerts, and automatic instance shutdown
            </p>
          </div>
        </div>
      </section>

      <section style={{ padding: "20px 0 80px" }}>
        <div className="container">
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "32px",
              }}
              className="docs-content"
            >
              <BudgetControlsDoc />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
