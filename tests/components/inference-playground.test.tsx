// @vitest-environment jsdom
//
// PA-288: InferencePlayground (src/components/InferencePlayground.tsx) — the
// streaming chat tester for a deployed model. On submit it POSTs to
// `/api/inference/chat` with `{ subscriptionId, messages, stream: true }` and
// consumes an OpenAI-style SSE stream via `response.body.getReader()`, parsing
// `data: {choices:[{delta:{content}}]}` lines and appending delta content into
// a growing assistant bubble. `[DONE]` and malformed JSON lines are skipped.
//
// We drive the stream with a fake ReadableStream reader that yields
// TextEncoder-encoded SSE chunks, then asserts incremental render, request
// shape, error handling, stats, and the clear-chat reset.
//
// NOTE: the inference COMPONENT lives in src/components (OSS). Only the
// /api/inference route is premium — we stub fetch, so no premium import.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import InferencePlayground from "@/components/InferencePlayground";

const encoder = new TextEncoder();

/** Build a fake streaming Response whose body.getReader() replays `chunks`. */
function streamingResponse(chunks: string[], opts: { ok?: boolean } = {}) {
  let i = 0;
  return {
    ok: opts.ok ?? true,
    status: 200,
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            const value = encoder.encode(chunks[i]);
            i += 1;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      }),
    },
  };
}

function sse(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function typeAndSend(text: string) {
  const input = screen.getByPlaceholderText(/Type a message/i);
  fireEvent.change(input, { target: { value: text } });
  // The send button is an icon-only submit; submit via the form directly.
  fireEvent.submit(input.closest("form")!);
  return input;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // jsdom does not implement scrollIntoView; the component's scroll-to-bottom
  // effect calls it on every message change.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("InferencePlayground — initial render", () => {
  it("shows the empty-state prompt and the model name in the header", () => {
    render(
      <InferencePlayground subscriptionId="sub-1" modelName="Mistral 7B" onClose={() => {}} />,
    );
    expect(screen.getByText("Inference Playground")).toBeInTheDocument();
    expect(screen.getByText("Mistral 7B")).toBeInTheDocument();
    expect(screen.getByText("Test Your Model")).toBeInTheDocument();
  });

  it("falls back to 'Instance <id>' when no model name is given", () => {
    render(<InferencePlayground subscriptionId="sub-xyz" onClose={() => {}} />);
    expect(screen.getByText("Instance sub-xyz")).toBeInTheDocument();
  });

  it("calls onClose when the close (X) button is clicked", () => {
    const onClose = vi.fn();
    render(<InferencePlayground subscriptionId="sub-1" onClose={onClose} />);
    // X button is the one with no accessible text alongside Clear.
    const buttons = screen.getAllByRole("button");
    // Clear is labelled; the X is the icon-only trailing button.
    const x = buttons.find((b) => b.textContent === "" && b.getAttribute("type") !== "submit");
    fireEvent.click(x!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the send button while the input is empty", () => {
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    const submit = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("type") === "submit")!;
    expect(submit).toBeDisabled();
  });
});

describe("InferencePlayground — streaming send", () => {
  it("POSTs to /api/inference/chat with the message body and streams the reply into the transcript", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(streamingResponse([sse("Hello"), sse(", "), sse("world"), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    render(<InferencePlayground subscriptionId="sub-42" token="tok-9" onClose={() => {}} />);
    typeAndSend("Hi there");

    // The user's message renders.
    await waitFor(() => expect(screen.getByText("Hi there")).toBeInTheDocument());
    // The streamed assistant content accumulates to "Hello, world".
    await waitFor(() => expect(screen.getByText("Hello, world")).toBeInTheDocument());

    // Request shape.
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/inference/chat");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok-9");
    const sent = JSON.parse(opts.body);
    expect(sent.subscriptionId).toBe("sub-42");
    expect(sent.stream).toBe(true);
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Hi there" });
  });

  it("renders latency / tokens-per-second / token-count stats after a stream completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamingResponse([sse("a"), sse("b"), "data: [DONE]\n\n"])),
    );
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("go");
    await waitFor(() => expect(screen.getByText("ab")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Latency:/)).toBeInTheDocument());
    // 2 content deltas -> 2 tokens.
    expect(screen.getByText("Tokens: 2")).toBeInTheDocument();
  });

  it("skips malformed JSON lines without crashing the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse(["data: {not valid json\n\n", sse("ok"), "data: [DONE]\n\n"]),
        ),
    );
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("go");
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
  });

  it("omits the Authorization header when no token is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse([sse("x"), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("go");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe("InferencePlayground — error handling", () => {
  it("surfaces the server error message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "model offline" }),
        body: null,
      }),
    );
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("hello");
    await waitFor(() => expect(screen.getByText("model offline")).toBeInTheDocument());

    // PA-314 regression guard: a non-ok response throws BEFORE any empty
    // assistant bubble is added, so the error cleanup must not remove the
    // user's own message.
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("falls back to a status-based message when the error body has no `error` field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), body: null }),
    );
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("hello");
    await waitFor(() => expect(screen.getByText(/status 503/)).toBeInTheDocument());
  });

  it("reports a generic failure when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("hello");
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });
});

describe("InferencePlayground — clear chat", () => {
  it("clears the transcript, error and stats back to the empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamingResponse([sse("hi"), "data: [DONE]\n\n"])),
    );
    render(<InferencePlayground subscriptionId="sub-1" onClose={() => {}} />);
    typeAndSend("go");
    await waitFor(() => expect(screen.getByText("hi")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("hi")).not.toBeInTheDocument();
    expect(screen.getByText("Test Your Model")).toBeInTheDocument();
  });
});
