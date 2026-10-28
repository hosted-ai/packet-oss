// @vitest-environment jsdom
//
// PA-309: pasted rich text lost bold + paragraph structure in the plain
// textarea. htmlToMarkdown() recovers it from the clipboard's text/html.
// Needs the DOM (DOMParser), hence the jsdom docblock.

import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "@/lib/announcements/html-to-markdown";

describe("htmlToMarkdown", () => {
  it("preserves paragraph breaks (the core bug)", () => {
    expect(htmlToMarkdown("<p>First paragraph.</p><p>Second paragraph.</p>")).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
  });

  it("preserves bold via <strong> and <b>", () => {
    expect(htmlToMarkdown("<p>Hello <strong>world</strong></p>")).toBe("Hello **world**");
    expect(htmlToMarkdown("<b>important</b>")).toBe("**important**");
  });

  it("preserves italics", () => {
    expect(htmlToMarkdown("<em>note</em>")).toBe("*note*");
    expect(htmlToMarkdown("<i>note</i>")).toBe("*note*");
  });

  it("turns <br> into a line break", () => {
    expect(htmlToMarkdown("line one<br>line two")).toBe("line one\nline two");
  });

  it("renders unordered and ordered lists", () => {
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
    expect(htmlToMarkdown("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
  });

  it("renders headings as markdown headings", () => {
    expect(htmlToMarkdown("<h2>Release 1.2</h2>")).toBe("## Release 1.2");
  });

  it("renders links", () => {
    expect(htmlToMarkdown('<a href="https://packet.ai">docs</a>')).toBe("[docs](https://packet.ai)");
  });

  it("handles a realistic pasted release note end-to-end", () => {
    const html =
      "<p><strong>What's new in v1.2</strong></p>" +
      "<p>We shipped region maintenance and rootfs persistence.</p>" +
      "<ul><li>Block provisions per region</li><li>Rootfs on by default</li></ul>";
    expect(htmlToMarkdown(html)).toBe(
      "**What's new in v1.2**\n\n" +
        "We shipped region maintenance and rootfs persistence.\n\n" +
        "- Block provisions per region\n- Rootfs on by default",
    );
  });

  it("collapses excess blank lines to a single paragraph gap", () => {
    expect(htmlToMarkdown("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });

  it("passes plain text through unchanged", () => {
    expect(htmlToMarkdown("just some text")).toBe("just some text");
  });
});
