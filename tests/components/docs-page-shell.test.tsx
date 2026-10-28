// @vitest-environment jsdom
//
// DocPage is the shell every /docs guide renders through: back link, the one
// page title, subtitle, and the guide body inside the .docs-content panel.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DocPage } from "@/app/(marketing)/docs/DocPage";
import { GettingStartedDoc } from "@/app/dashboard/components/docs/GettingStartedDoc";

describe("DocPage", () => {
  it("renders the title as the only h1 above the guide body", () => {
    render(
      <DocPage title="Getting Started" subtitle="Deploy your first GPU in under 60 seconds">
        <GettingStartedDoc />
      </DocPage>,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Getting Started");
    expect(screen.getByText("Deploy your first GPU in under 60 seconds")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to docs/i })).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("article")).toHaveClass("docs-content");
  });
});
