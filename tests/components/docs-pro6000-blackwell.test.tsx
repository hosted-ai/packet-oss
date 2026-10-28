// @vitest-environment jsdom
//
// PA-287: Pro6000BlackwellDoc is a static documentation panel for the RTX Pro
// 6000 Blackwell optimized model templates. These tests pin the title, the
// hardware spec table, the pre-configured model sections, the vLLM launch
// snippets, and the troubleshooting/security sections.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Pro6000BlackwellDoc } from "@/app/dashboard/components/docs/Pro6000BlackwellDoc";

describe("Pro6000BlackwellDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<Pro6000BlackwellDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/one-click deploy templates for nvidia rtx pro 6000 blackwell/i),
    ).toBeInTheDocument();
  });

  it("documents the hardware specifications", () => {
    render(<Pro6000BlackwellDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /hardware specifications/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("96 GB GDDR7")).toBeInTheDocument();
    expect(screen.getByText("1.8 TB/s")).toBeInTheDocument();
    expect(screen.getByText("18,176")).toBeInTheDocument();
  });

  it("lists the pre-configured models with headings", () => {
    render(<Pro6000BlackwellDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /llama 3\.1 70b instruct/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /qwen 2\.5 72b instruct/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /deepseek r1 distill 32b/i }),
    ).toBeInTheDocument();
  });

  it("shows the optimal vLLM api_server launch snippet", () => {
    render(<Pro6000BlackwellDoc />);
    expect(
      screen.getByText(/--model meta-llama\/Llama-3\.1-70B-Instruct/),
    ).toBeInTheDocument();
  });

  it("documents the OOM troubleshooting steps", () => {
    render(<Pro6000BlackwellDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /out of memory \(oom\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/CUDA OOM error during model loading/i),
    ).toBeInTheDocument();
  });

  it("includes a performance benchmarks table", () => {
    render(<Pro6000BlackwellDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /performance benchmarks/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("42 t/s")).toBeInTheDocument();
  });

  it("recommends API authentication in production with an openssl key snippet", () => {
    render(<Pro6000BlackwellDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /api authentication/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/API_KEY=\$\(openssl rand -hex 32\)/),
    ).toBeInTheDocument();
  });
});
