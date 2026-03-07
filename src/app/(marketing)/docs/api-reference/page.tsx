"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function ApiReferencePage() {
  return (
    <>
      <section style={{ paddingTop: "40px", paddingBottom: "20px" }}>
        <div className="container">
          <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
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
              API Reference
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "16px" }}>
              Complete REST API documentation with interactive examples
            </p>
          </div>
        </div>
      </section>

      <section style={{ padding: "20px 0 80px" }}>
        <div className="container">
          <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "24px",
                overflow: "hidden",
              }}
              className="swagger-wrapper"
            >
              <SwaggerUI url="/api/openapi" />
            </div>
          </div>
        </div>
      </section>

      <style jsx global>{`
        .swagger-wrapper .swagger-ui {
          font-family: var(--font-body), "IBM Plex Sans", sans-serif;
        }
        .swagger-wrapper .swagger-ui .info {
          margin: 20px 0;
        }
        .swagger-wrapper .swagger-ui .info .title {
          font-family: var(--font-display), "Outfit", sans-serif;
          font-size: 1.8rem;
          color: var(--ink);
        }
        .swagger-wrapper .swagger-ui .info .description p {
          color: var(--muted);
        }
        .swagger-wrapper .swagger-ui .opblock-tag {
          font-family: var(--font-display), "Outfit", sans-serif;
          border-bottom: 1px solid var(--line);
        }
        .swagger-wrapper .swagger-ui .opblock {
          border-radius: 8px;
          margin-bottom: 8px;
          border: 1px solid var(--line);
          box-shadow: none;
        }
        .swagger-wrapper .swagger-ui .opblock .opblock-summary {
          border-radius: 8px;
        }
        .swagger-wrapper .swagger-ui .opblock.opblock-get {
          background: rgba(97, 175, 254, 0.1);
          border-color: rgba(97, 175, 254, 0.3);
        }
        .swagger-wrapper .swagger-ui .opblock.opblock-post {
          background: rgba(73, 204, 144, 0.1);
          border-color: rgba(73, 204, 144, 0.3);
        }
        .swagger-wrapper .swagger-ui .opblock.opblock-put {
          background: rgba(252, 161, 48, 0.1);
          border-color: rgba(252, 161, 48, 0.3);
        }
        .swagger-wrapper .swagger-ui .opblock.opblock-delete {
          background: rgba(249, 62, 62, 0.1);
          border-color: rgba(249, 62, 62, 0.3);
        }
        .swagger-wrapper .swagger-ui .opblock.opblock-patch {
          background: rgba(80, 227, 194, 0.1);
          border-color: rgba(80, 227, 194, 0.3);
        }
        .swagger-wrapper .swagger-ui .btn {
          border-radius: 6px;
        }
        .swagger-wrapper .swagger-ui .btn.execute {
          background: var(--blue);
          border-color: var(--blue);
        }
        .swagger-wrapper .swagger-ui .btn.execute:hover {
          background: var(--blue-dark);
        }
        .swagger-wrapper .swagger-ui select {
          border-radius: 6px;
        }
        .swagger-wrapper .swagger-ui input[type="text"],
        .swagger-wrapper .swagger-ui textarea {
          border-radius: 6px;
        }
        .swagger-wrapper .swagger-ui .model-box {
          background: var(--bg);
          border-radius: 8px;
        }
        .swagger-wrapper .swagger-ui section.models {
          border: 1px solid var(--line);
          border-radius: 8px;
        }
        .swagger-wrapper .swagger-ui .response-col_status {
          font-family: monospace;
        }
      `}</style>
    </>
  );
}
