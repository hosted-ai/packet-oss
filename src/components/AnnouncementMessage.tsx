"use client";

/**
 * Renders an announcement body as markdown (PA-309) — preserves paragraph
 * breaks, spacing, bold/italic, lists and links that a plain {message} text
 * node would flatten. Color is inherited from the caller (white on the blue
 * banner, dark in the modal), so the same component works everywhere. XSS-safe:
 * react-markdown does not render raw HTML.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AnnouncementMessage({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Compact spacing so paragraphs read tightly inside a banner/modal.
        p: ({ children }) => <p style={{ margin: "0 0 6px 0" }}>{children}</p>,
        ul: ({ children }) => <ul style={{ margin: "0 0 6px 0", paddingLeft: 18 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "0 0 6px 0", paddingLeft: 18 }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
            {children}
          </a>
        ),
        // Headings in a small announcement read as bold lead-ins, not big H1s.
        h1: ({ children }) => <strong style={{ display: "block", margin: "0 0 4px 0" }}>{children}</strong>,
        h2: ({ children }) => <strong style={{ display: "block", margin: "0 0 4px 0" }}>{children}</strong>,
        h3: ({ children }) => <strong style={{ display: "block", margin: "0 0 4px 0" }}>{children}</strong>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
