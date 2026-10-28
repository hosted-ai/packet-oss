/**
 * Instance → vGPU-count cache for the Daily Ops Summary (PA-195-adjacent).
 *
 * The unified-instances LIST endpoint carries `pod_info.pool_id` but NOT
 * `vgpu_count` — only the per-instance DETAIL endpoint does. To sum real vGPUs
 * for a pool metric we'd otherwise detail-call every matched instance every run.
 *
 * `vgpu_count` is IMMUTABLE for an instance's lifetime, so we cache it on disk
 * keyed by instance id: a given instance is detail-called at most once, ever.
 * No TTL. Entries for terminated instances are harmless (just stale rows); we
 * don't prune (the map tracks total distinct instances seen, which stays small).
 */
import fs from "fs";
import path from "path";
import { getUnifiedInstanceDetail, type UnifiedInstanceDetail } from "@/lib/hostedai/instances";

const CACHE_FILE = path.join(process.cwd(), "data", "cache", "instance-vgpu.json");

type VgpuCache = Record<string, number>;

function read(): VgpuCache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as VgpuCache;
  } catch {
    return {};
  }
}

function write(cache: VgpuCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch (err) {
    console.error("[ops-vgpu-cache] failed to persist cache:", err);
  }
}

/**
 * Resolve vGPU counts for the given instance ids. Cached ids return instantly;
 * misses are detail-fetched (and cached). An instance whose detail fetch fails is
 * omitted from the result (the caller sums what resolved) — never guessed.
 *
 * `getDetail` is injectable for tests.
 */
export async function getVgpuCounts(
  ids: string[],
  getDetail: (id: string) => Promise<UnifiedInstanceDetail> = getUnifiedInstanceDetail,
): Promise<Record<string, number>> {
  const cache = read();
  let dirty = false;

  for (const id of new Set(ids)) {
    if (typeof cache[id] === "number") continue;
    try {
      const detail = await getDetail(id);
      cache[id] = detail.pod_info?.vgpu_count ?? 1; // guard undefined → 1
      dirty = true;
    } catch (err) {
      console.error(`[ops-vgpu-cache] detail fetch failed for ${id}:`, err);
    }
  }

  if (dirty) write(cache);

  const out: Record<string, number> = {};
  for (const id of ids) if (typeof cache[id] === "number") out[id] = cache[id];
  return out;
}
