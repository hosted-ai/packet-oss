import { describe, it, expect } from "vitest";
import {
  groupMonthlyByCategory,
  shouldShowCategoryStep,
  findBucketBySlug,
  OTHER_BUCKET_KEY,
} from "@/app/dashboard/components/monthly-plans";

const cat = (id: string, name: string, slug: string, displayOrder = 0) => ({ id, name, slug, displayOrder });

describe("groupMonthlyByCategory", () => {
  it("groups plans under each of their categories", () => {
    const buckets = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "B200", "b200", 0)] },
      { id: "p2", categories: [cat("c2", "H100", "h100", 1)] },
    ]);
    expect(buckets.map((b) => b.slug)).toEqual(["b200", "h100"]);
    expect(buckets[0].products.map((p) => p.id)).toEqual(["p1"]);
  });

  it("puts untagged plans in an 'Other plans' bucket, always last", () => {
    const buckets = groupMonthlyByCategory([
      { id: "p1", categories: [] },
      { id: "p2", categories: [cat("c1", "B200", "b200", 0)] },
    ]);
    expect(buckets.map((b) => b.key)).toEqual(["b200", OTHER_BUCKET_KEY]);
    const other = buckets.find((b) => b.key === OTHER_BUCKET_KEY)!;
    expect(other.name).toBe("Other plans");
    expect(other.slug).toBeNull();
    expect(other.products.map((p) => p.id)).toEqual(["p1"]);
  });

  it("places a multi-category plan in every matching bucket", () => {
    const buckets = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "B200", "b200", 0), cat("c2", "H100", "h100", 1)] },
    ]);
    expect(buckets.map((b) => b.slug)).toEqual(["b200", "h100"]);
    expect(buckets.every((b) => b.products[0].id === "p1")).toBe(true);
  });

  it("sorts real categories by displayOrder", () => {
    const buckets = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "Zeta", "zeta", 5)] },
      { id: "p2", categories: [cat("c2", "Alpha", "alpha", 1)] },
    ]);
    expect(buckets.map((b) => b.slug)).toEqual(["alpha", "zeta"]);
  });

  it("treats null/undefined categories as untagged", () => {
    const buckets = groupMonthlyByCategory([{ id: "p1" }, { id: "p2", categories: null }]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe(OTHER_BUCKET_KEY);
  });
});

describe("shouldShowCategoryStep", () => {
  it("hides the step when everything collapses to one bucket", () => {
    const buckets = groupMonthlyByCategory([{ id: "p1", categories: [] }, { id: "p2", categories: [] }]);
    expect(shouldShowCategoryStep(buckets)).toBe(false);
  });

  it("shows the step with 2+ buckets (a category + untagged counts)", () => {
    const buckets = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "B200", "b200")] },
      { id: "p2", categories: [] },
    ]);
    expect(shouldShowCategoryStep(buckets)).toBe(true);
  });
});

describe("findBucketBySlug", () => {
  const buckets = groupMonthlyByCategory([
    { id: "p1", categories: [cat("c1", "B200", "b200")] },
    { id: "p2", categories: [] },
  ]);

  it("finds a bucket by category slug (deep-link target)", () => {
    expect(findBucketBySlug(buckets, "b200")?.key).toBe("b200");
  });

  it("returns undefined for an unknown or empty slug (graceful fallthrough)", () => {
    expect(findBucketBySlug(buckets, "nope")).toBeUndefined();
    expect(findBucketBySlug(buckets, undefined)).toBeUndefined();
    expect(findBucketBySlug(buckets, null)).toBeUndefined();
  });

  // Vendor-prefix drift: auto-generated slugs are "nvidia-b200" while the
  // deeplink contract and marketing CTAs speak "b200" (and vice versa after
  // a slug rename, for URLs minted before it). Deep-links must survive both.
  it("falls back to a hyphen-boundary suffix match (deeplink 'b200' → slug 'nvidia-b200')", () => {
    const drifted = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "NVIDIA B200", "nvidia-b200")] },
    ]);
    expect(findBucketBySlug(drifted, "b200")?.slug).toBe("nvidia-b200");
  });

  it("matches a stale pre-rename URL ('nvidia-b200' → slug 'b200')", () => {
    expect(findBucketBySlug(buckets, "nvidia-b200")?.slug).toBe("b200");
  });

  it("prefers an exact match over a fuzzy one", () => {
    const both = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "NVIDIA B200", "nvidia-b200")] },
      { id: "p2", categories: [cat("c2", "B200", "b200")] },
    ]);
    expect(findBucketBySlug(both, "b200")?.slug).toBe("b200");
  });

  it("does not match a non-boundary suffix ('b200' must not hit 'rtx-5200')", () => {
    const other = groupMonthlyByCategory([
      { id: "p1", categories: [cat("c1", "RTX 5200", "rtx-5200")] },
    ]);
    expect(findBucketBySlug(other, "b200")).toBeUndefined();
    expect(findBucketBySlug(other, "200")).toBeUndefined();
  });

  it("is case-insensitive on the requested slug (?gpu=B200)", () => {
    expect(findBucketBySlug(buckets, "B200")?.slug).toBe("b200");
  });
});
