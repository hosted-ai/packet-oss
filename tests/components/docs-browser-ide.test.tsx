// @vitest-environment jsdom
//
// PA-287: BrowserIDEDoc is a static documentation panel covering browser-based
// IDEs (code-server, Jupyter Lab). These tests pin the headings, the external
// code-server link, and the concrete commands/ports the doc instructs users to
// run.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { BrowserIDEDoc } from "@/app/dashboard/components/docs/BrowserIDEDoc";

describe("BrowserIDEDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<BrowserIDEDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/jupyter lab, vs code, and other development tools/i),
    ).toBeInTheDocument();
  });

  it("documents the two main IDE sections", () => {
    render(<BrowserIDEDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /vs code in browser \(code-server\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /^jupyter lab$/i }),
    ).toBeInTheDocument();
  });

  it("links to the upstream code-server repository, opening in a new tab", () => {
    render(<BrowserIDEDoc />);
    const link = screen.getByRole("link", { name: /code-server/i });
    expect(link).toHaveAttribute("href", "https://github.com/coder/code-server");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the code-server install one-liner", () => {
    render(<BrowserIDEDoc />);
    expect(
      screen.getByText(/curl -fsSL https:\/\/code-server\.dev\/install\.sh \| sh/),
    ).toBeInTheDocument();
  });

  it("includes the GPU-availability torch check snippet", () => {
    render(<BrowserIDEDoc />);
    expect(
      screen.getByText(/CUDA available: \{torch\.cuda\.is_available\(\)\}/),
    ).toBeInTheDocument();
  });

  it("lists security considerations", () => {
    render(<BrowserIDEDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /security considerations/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/always use authentication/i)).toBeInTheDocument();
  });

  it("documents the troubleshooting section", () => {
    render(<BrowserIDEDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /troubleshooting/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /service not accessible/i }),
    ).toBeInTheDocument();
  });
});
