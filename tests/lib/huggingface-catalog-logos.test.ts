import { describe, it, expect } from "vitest";
import { getAllCatalogItems } from "@/lib/huggingface-catalog";

// Every huggingface.co/<org>/resolve/main/<file> logo the catalogue shipped
// returned 401: that path names a file inside a repo, and an org alone is not a
// repo. The card falls back to its type glyph on an empty logo, so absent beats
// dead — an unreachable URL renders an empty box instead.
describe("catalogue logos", () => {
  it("ships no repo-file logo URL, every one of which 401s", () => {
    const unreachable = getAllCatalogItems()
      .filter((item) => item.logo?.includes("/resolve/main/"))
      .map((item) => `${item.id} → ${item.logo}`);

    expect(unreachable).toEqual([]);
  });
});
