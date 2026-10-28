// PA-675: the tenant-admin support view rendered Zammad article bodies through
// dangerouslySetInnerHTML with no sanitiser while the admin copy of the same view
// used DOMPurify. Both now share this helper, so it is pinned here.

import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize-html";

describe("sanitizeHtml", () => {
  it("strips script tags", () => {
    const out = sanitizeHtml('<p>Hi</p><script>alert("xss")</script>');
    expect(out).toContain("Hi");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it("strips javascript: URLs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps the formatting a knowledge-base article legitimately uses", () => {
    const out = sanitizeHtml(
      '<p>Restart with <strong>sudo</strong> and see <a href="https://packet.ai/docs">docs</a>.</p><ul><li>one</li></ul>'
    );
    expect(out).toContain("<strong>");
    expect(out).toContain("<li>");
    expect(out).toContain('href="https://packet.ai/docs"');
  });

  it("passes plain text through unchanged", () => {
    expect(sanitizeHtml("just text")).toBe("just text");
  });
});
