// PA-309 (render half): the announcement body must render markdown — bold,
// paragraphs, lists — not flatten it to plain text. Frontend project (jsdom).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnnouncementMessage } from "@/components/AnnouncementMessage";

describe("AnnouncementMessage", () => {
  it("renders separate paragraphs and bold (the bug was a flat text node)", () => {
    const { container } = render(
      <AnnouncementMessage text={"First paragraph.\n\nSecond **bold** paragraph."} />,
    );
    expect(container.querySelectorAll("p").length).toBe(2);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders lists", () => {
    const { container } = render(<AnnouncementMessage text={"- one\n- two\n- three"} />);
    expect(container.querySelectorAll("li").length).toBe(3);
  });

  it("does not render raw HTML (XSS-safe)", () => {
    const { container } = render(
      <AnnouncementMessage text={'<img src=x onerror="alert(1)">'} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
