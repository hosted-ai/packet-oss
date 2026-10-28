// Tests for src/lib/ops-vgpu-cache.ts — instance → vgpu_count disk cache.
// fs is mocked with an in-memory store so cache state persists across calls
// within a test; getUnifiedInstanceDetail is injected.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UnifiedInstanceDetail } from "@/lib/hostedai/instances";

let store: string | null = null;
vi.mock("fs", () => ({
  default: {
    readFileSync: () => {
      if (store === null) throw new Error("ENOENT");
      return store;
    },
    writeFileSync: (_p: string, data: string) => {
      store = data;
    },
    mkdirSync: () => undefined,
  },
}));

import { getVgpuCounts } from "@/lib/ops-vgpu-cache";

const detail = (id: string, vgpu?: number): UnifiedInstanceDetail =>
  ({ id, pod_info: vgpu === undefined ? {} : { vgpu_count: vgpu } }) as unknown as UnifiedInstanceDetail;

beforeEach(() => {
  store = null;
  vi.clearAllMocks();
});

describe("getVgpuCounts", () => {
  it("detail-calls misses, then serves hits from cache without re-fetching", async () => {
    const getDetail = vi.fn(async (id: string) => detail(id, id === "a" ? 2 : 4));
    const r1 = await getVgpuCounts(["a", "b"], getDetail);
    expect(r1).toEqual({ a: 2, b: 4 });
    expect(getDetail).toHaveBeenCalledTimes(2);

    const r2 = await getVgpuCounts(["a", "b"], getDetail);
    expect(r2).toEqual({ a: 2, b: 4 });
    expect(getDetail).toHaveBeenCalledTimes(2); // both cached → no new calls
  });

  it("only fetches the uncached ids", async () => {
    const getDetail = vi.fn(async (id: string) => detail(id, 1));
    await getVgpuCounts(["a"], getDetail); // caches a
    getDetail.mockClear();
    await getVgpuCounts(["a", "b"], getDetail); // only b is a miss
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenCalledWith("b");
  });

  it("omits an instance whose detail fetch fails (never guesses)", async () => {
    const getDetail = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("404");
      return detail(id, 3);
    });
    const r = await getVgpuCounts(["ok", "bad"], getDetail);
    expect(r).toEqual({ ok: 3 });
  });

  it("guards an undefined vgpu_count to 1", async () => {
    const getDetail = vi.fn(async (id: string) => detail(id, undefined));
    expect(await getVgpuCounts(["x"], getDetail)).toEqual({ x: 1 });
  });

  it("dedupes repeated ids in the input", async () => {
    const getDetail = vi.fn(async (id: string) => detail(id, 2));
    await getVgpuCounts(["a", "a", "a"], getDetail);
    expect(getDetail).toHaveBeenCalledTimes(1);
  });
});
