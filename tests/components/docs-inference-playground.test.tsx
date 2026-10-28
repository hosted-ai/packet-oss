// @vitest-environment jsdom
//
// PA-287: InferencePlaygroundDoc is a static documentation panel for the
// interactive chat playground. These tests pin the title, the zero-config
// fixed-settings claims (auto-detected model, 2,048-token response cap),
// the "Test Chat" entry point, the interface component descriptions, the
// performance stats bar, and the pointer to the vLLM OpenAI-compatible API.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { InferencePlaygroundDoc } from "@/app/dashboard/components/docs/InferencePlaygroundDoc";

describe("InferencePlaygroundDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<InferencePlaygroundDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/interactive chat interface for testing/i),
    ).toBeInTheDocument();
  });

  it("lists the key features", () => {
    render(<InferencePlaygroundDoc />);
    expect(screen.getByText(/real-time streaming/i)).toBeInTheDocument();
    expect(screen.getByText(/zero configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/conversation history/i)).toBeInTheDocument();
    expect(
      screen.getByText(/latency, generation speed, and token count/i),
    ).toBeInTheDocument();
  });

  it("documents access via the Test Chat button on the instance card", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /accessing the playground/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/test chat/i)).toBeInTheDocument();
    expect(screen.getByText(/expose api endpoint/i)).toBeInTheDocument();
    expect(
      screen.getByText(/if port 8000 is not yet exposed/i),
    ).toBeInTheDocument();
  });

  it("documents the fixed configuration options", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /configuration options/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/uses fixed generation settings/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/detected automatically from your instance/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/capped at 2,048 tokens per response/i),
    ).toBeInTheDocument();
  });

  it("points parameter tuning at the exposed vLLM OpenAI-compatible API", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByText(
        /call your instance's exposed vLLM OpenAI-compatible API directly/i,
      ),
    ).toBeInTheDocument();
  });

  it("describes the interface components (chat area and input area)", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /chat area/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /input area/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/typing indicator/i)).toBeInTheDocument();
    expect(
      screen.getByText(/enter to send, shift\+enter for a new line/i),
    ).toBeInTheDocument();
  });

  it("documents the performance stats bar", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /performance stats/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/total time taken for the response/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/generation speed in tokens per second/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/number of tokens in the response/i),
    ).toBeInTheDocument();
  });

  it("shows the conversation pattern examples", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /conversation patterns/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /multi-turn conversations/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /chain-of-thought prompting/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/a farmer has 17 sheep/i)).toBeInTheDocument();
  });

  it("lists best-practice tips", () => {
    render(<InferencePlaygroundDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /tips & best practices/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/be specific/i)).toBeInTheDocument();
    expect(
      screen.getByText(/your message stays in the conversation/i),
    ).toBeInTheDocument();
  });
});
