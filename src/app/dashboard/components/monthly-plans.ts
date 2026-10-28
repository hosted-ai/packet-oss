/**
 * Pure grouping logic for the monthly subscription flow.
 *
 * Monthly plans mirror the on-demand stepper: pick a GPU type (category), then a
 * plan within it. GpuProduct<->GpuCategory is a many-to-many that applies to
 * monthly products too, so we group the monthly plans by their categories. Plans
 * with no category fall into an "Other plans" bucket so nothing disappears.
 *
 * The GPU-type step only appears when there are at least two buckets — a single
 * bucket (e.g. nothing is tagged yet) collapses to the flat plan list, matching
 * the on-demand modal's behaviour of skipping step 1 when there are no categories.
 */

import { slugMatches } from "./utils";

export interface PlanCategory {
  id: string;
  name: string;
  slug: string;
  displayOrder?: number;
}

export interface MonthlyProductLike {
  id: string;
  categories?: PlanCategory[] | null;
}

export interface PlanBucket<T> {
  /** Category slug, or OTHER_BUCKET_KEY for untagged plans. */
  key: string;
  name: string;
  slug: string | null;
  displayOrder: number;
  products: T[];
}

export const OTHER_BUCKET_KEY = "__other__";

export function groupMonthlyByCategory<T extends MonthlyProductLike>(products: T[]): PlanBucket<T>[] {
  const byKey = new Map<string, PlanBucket<T>>();

  const ensureBucket = (cat: PlanCategory | null): PlanBucket<T> => {
    const key = cat ? cat.slug : OTHER_BUCKET_KEY;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        name: cat ? cat.name : "Other plans",
        slug: cat ? cat.slug : null,
        displayOrder: cat?.displayOrder ?? Number.MAX_SAFE_INTEGER,
        products: [],
      };
      byKey.set(key, bucket);
    }
    return bucket;
  };

  for (const product of products) {
    const cats = product.categories ?? [];
    if (cats.length === 0) {
      ensureBucket(null).products.push(product);
    } else {
      for (const cat of cats) ensureBucket(cat).products.push(product);
    }
  }

  // Real categories first (by displayOrder, then name); "Other plans" always last.
  return [...byKey.values()].sort((a, b) => {
    if (a.key === OTHER_BUCKET_KEY) return 1;
    if (b.key === OTHER_BUCKET_KEY) return -1;
    return a.displayOrder - b.displayOrder || a.name.localeCompare(b.name);
  });
}

/** Show the GPU-type step only when grouping into 2+ buckets is meaningful. */
export function shouldShowCategoryStep<T>(buckets: PlanBucket<T>[]): boolean {
  return buckets.length >= 2;
}

export function findBucketBySlug<T>(
  buckets: PlanBucket<T>[],
  slug?: string | null,
): PlanBucket<T> | undefined {
  if (!slug) return undefined;
  // Exact first; then tolerant match so ?gpu= deep-links survive slug drift
  // ("b200" ↔ "nvidia-b200") and renames (URLs minted with the old slug).
  return (
    buckets.find((b) => b.slug === slug) ??
    buckets.find((b) => slugMatches(b.slug, slug))
  );
}
