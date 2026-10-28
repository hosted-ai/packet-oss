// @vitest-environment jsdom
//
// PA-287: HuggingFaceDoc is the static documentation panel for one-click model
// deployment (distinct from the interactive HuggingFaceTab covered by
// huggingface-tab-empty-state.test.tsx). These tests pin the title, the TOC
// anchors, the recommended-model table, the external gated-model links, and
// the GPU sizing guide.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { HuggingFaceDoc } from "@/app/dashboard/components/docs/HuggingFaceDoc";

describe("HuggingFaceDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<HuggingFaceDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/deploy huggingface models with one click/i),
    ).toBeInTheDocument();
  });

  it("links the table of contents to overview and troubleshooting anchors", () => {
    render(<HuggingFaceDoc />);
    expect(
      screen.getByRole("link", { name: /^overview$/i }),
    ).toHaveAttribute("href", "#overview");
    expect(
      screen.getByRole("link", { name: /gpu sizing guide/i }),
    ).toHaveAttribute("href", "#gpu-sizing");
  });

  it("documents recommended general-purpose models with code identifiers", () => {
    render(<HuggingFaceDoc />);
    expect(
      screen.getByText("meta-llama/Llama-3.1-8B-Instruct"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("mistralai/Mistral-7B-Instruct-v0.3"),
    ).toBeInTheDocument();
  });

  it("links to the gated-model license pages, opening in new tabs", () => {
    render(<HuggingFaceDoc />);
    const llamaLink = screen.getByRole("link", { name: /llama 3\.1/i });
    expect(llamaLink).toHaveAttribute(
      "href",
      "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct",
    );
    expect(llamaLink).toHaveAttribute("target", "_blank");

    const tokensLink = screen.getByRole("link", {
      name: /huggingface\.co\/settings\/tokens/i,
    });
    expect(tokensLink).toHaveAttribute(
      "href",
      "https://huggingface.co/settings/tokens",
    );
  });

  it("explains that the HuggingFace token is never stored permanently", () => {
    render(<HuggingFaceDoc />);
    expect(
      screen.getByText(/never stored permanently/i),
    ).toBeInTheDocument();
  });

  it("documents the deployment status stages", () => {
    render(<HuggingFaceDoc />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Deploying")).toBeInTheDocument();
    expect(screen.getByText("Installing")).toBeInTheDocument();
  });

  it("provides a GPU sizing guide with memory rule-of-thumb", () => {
    render(<HuggingFaceDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /gpu sizing guide/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/each billion parameters needs ~2gb in fp16/i),
    ).toBeInTheDocument();
  });

  it("shows the curl example for the deployed endpoint", () => {
    render(<HuggingFaceDoc />);
    expect(
      screen.getByText(/curl http:\/\/YOUR-IP:PORT\/v1\/chat\/completions/),
    ).toBeInTheDocument();
  });
});
