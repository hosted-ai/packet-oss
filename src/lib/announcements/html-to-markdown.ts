/**
 * Convert pasted rich-text HTML (from a doc / release notes) into markdown so a
 * plain <textarea> can hold it and react-markdown can render it back. Covers the
 * tags release notes actually use: paragraphs, line breaks, bold/italic,
 * headings, lists, links. PA-309.
 *
 * Browser/jsdom only (uses DOMParser). Called from the announcement editor's
 * onPaste handler (client component); tested under jsdom.
 */

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // HTML whitespace is insignificant — collapse runs to a single space.
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = walk(el);
  const trimmed = inner.trim();

  switch (tag) {
    case "strong":
    case "b":
      return trimmed ? `**${trimmed}**` : "";
    case "em":
    case "i":
      return trimmed ? `*${trimmed}*` : "";
    case "br":
      return "\n";
    case "p":
    case "div":
    case "section":
      return trimmed ? `\n\n${trimmed}\n\n` : "";
    case "h1":
      return trimmed ? `\n\n# ${trimmed}\n\n` : "";
    case "h2":
      return trimmed ? `\n\n## ${trimmed}\n\n` : "";
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return trimmed ? `\n\n### ${trimmed}\n\n` : "";
    case "ul":
    case "ol":
      return `\n\n${renderList(el, tag)}\n\n`;
    case "li":
      return inner; // handled by renderList
    case "a": {
      const href = el.getAttribute("href");
      return href && trimmed ? `[${trimmed}](${href})` : trimmed;
    }
    default:
      return inner;
  }
}

function walk(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    out += renderNode(child);
  });
  return out;
}

function renderList(el: HTMLElement, tag: string): string {
  const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li");
  return items
    .map((li, i) => {
      const text = walk(li).trim().replace(/\s*\n\s*/g, " ");
      const marker = tag === "ol" ? `${i + 1}.` : "-";
      return `${marker} ${text}`;
    })
    .join("\n");
}

/**
 * Convert an HTML fragment (e.g. clipboard text/html) to markdown. Returns ""
 * for empty input. Collapses excess blank lines so paragraph spacing is exactly
 * one blank line.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const md = walk(doc.body);
  return md
    .replace(/[ \t]+\n/g, "\n") // strip trailing spaces on each line
    .replace(/\n{3,}/g, "\n\n") // at most one blank line between blocks
    .trim();
}
