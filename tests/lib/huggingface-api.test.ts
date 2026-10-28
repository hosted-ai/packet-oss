// Deepening tests for src/lib/huggingface-api.ts — exercises the REAL functions
// (parsing/estimation math + fetch error handling), not a mock of the module.
//
// External boundary mocked: global fetch (via vi.stubGlobal). The module under
// test is imported for real. The module keeps an in-process response cache, so
// each test uses a unique query string to stay cache-independent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchModels,
  searchSpaces,
  getModelInfo,
  isGatedModel,
  estimateVramFromModel,
  estimateParamsFromModel,
  estimateDiskSizeFromModel,
  searchAll,
  getPopularTextGenerationModels,
  STANDARD_EPHEMERAL_STORAGE_GB,
  type HFModel,
} from "@/lib/huggingface-api";

const mockFetch = vi.fn();

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}
function errStatus(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

function makeModel(overrides: Partial<HFModel> = {}): HFModel {
  return {
    id: "org/model-7b",
    modelId: "org/model-7b",
    author: "org",
    sha: "abc",
    lastModified: "2024-01-01",
    private: false,
    gated: false,
    disabled: false,
    downloads: 100,
    likes: 10,
    tags: [],
    createdAt: "2024-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("estimateVramFromModel", () => {
  it("uses safetensors parameter count: 2 bytes/param + 20% overhead, ceil to GB", () => {
    // 1e9 params -> 1e9 * 2 * 1.2 = 2.4e9 bytes -> /1024^3 = ~2.235 -> ceil 3
    const model = makeModel({ safetensors: { parameters: { F16: 1_000_000_000 } } });
    expect(estimateVramFromModel(model)).toBe(3);
  });

  it("sums multiple safetensors dtype parameter buckets", () => {
    const model = makeModel({
      safetensors: { parameters: { F16: 500_000_000, F32: 500_000_000 } },
    });
    // total 1e9 params -> same 3GB
    expect(estimateVramFromModel(model)).toBe(3);
  });

  it("falls back to sibling weight file sizes when no safetensors metadata", () => {
    const model = makeModel({
      siblings: [
        { rfilename: "model.safetensors", size: 2 * 1024 * 1024 * 1024 },
        { rfilename: "README.md", size: 1000 }, // ignored (not a weight file)
      ],
    });
    // 2GB * 1.2 = 2.4GB -> ceil 3
    expect(estimateVramFromModel(model)).toBe(3);
  });

  it("parses '7b' from the model name when no metadata or files", () => {
    const model = makeModel({ id: "meta/Llama-7B" });
    // 7 * 2 * 1.2 = 16.8 -> ceil 17
    expect(estimateVramFromModel(model)).toBe(17);
  });

  it("returns 0 when size is entirely unknown", () => {
    const model = makeModel({ id: "org/mystery-model" });
    expect(estimateVramFromModel(model)).toBe(0);
  });
});

describe("estimateParamsFromModel", () => {
  it("converts safetensors total to billions rounded to 1 decimal", () => {
    const model = makeModel({ safetensors: { parameters: { F16: 7_240_000_000 } } });
    expect(estimateParamsFromModel(model)).toBe(7.2);
  });

  it("parses billions from the name pattern (e.g. 1.5b)", () => {
    expect(estimateParamsFromModel(makeModel({ id: "qwen/Qwen-1.5B" }))).toBe(1.5);
  });

  it("parses millions from the name and converts to billions", () => {
    // "350m" -> 350/1000 = 0.35
    expect(estimateParamsFromModel(makeModel({ id: "org/tiny-350M" }))).toBe(0.35);
  });

  it("returns undefined when params cannot be inferred", () => {
    expect(estimateParamsFromModel(makeModel({ id: "org/unknown" }))).toBeUndefined();
  });
});

describe("estimateDiskSizeFromModel", () => {
  it("sums all sibling sizes and ceils to GB", () => {
    const model = makeModel({
      siblings: [
        { rfilename: "a.safetensors", size: 1024 * 1024 * 1024 },
        { rfilename: "b.bin", size: 512 * 1024 * 1024 },
      ],
    });
    // 1.5GB -> ceil 2
    expect(estimateDiskSizeFromModel(model)).toBe(2);
  });

  it("returns 0 when there are no siblings", () => {
    expect(estimateDiskSizeFromModel(makeModel({ siblings: [] }))).toBe(0);
    expect(estimateDiskSizeFromModel(makeModel())).toBe(0);
  });

  it("returns 0 when sibling sizes are all undefined/zero", () => {
    const model = makeModel({ siblings: [{ rfilename: "x.safetensors" }] });
    expect(estimateDiskSizeFromModel(model)).toBe(0);
  });

  it("exposes the standard ephemeral storage constant", () => {
    expect(STANDARD_EPHEMERAL_STORAGE_GB).toBe(150);
  });
});

describe("isGatedModel", () => {
  it("returns the boolean gated flag", () => {
    expect(isGatedModel(makeModel({ gated: true }))).toBe(true);
    expect(isGatedModel(makeModel({ gated: false }))).toBe(false);
  });

  it("coerces non-boolean gated values (auto/manual) to true", () => {
    expect(isGatedModel(makeModel({ gated: "manual" }))).toBe(true);
  });
});

describe("searchModels", () => {
  it("maps HF API results to search-result shape with derived fields", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        makeModel({
          id: "org/cool-7b",
          pipeline_tag: "text-generation",
          library_name: "transformers",
          cardData: { license: "apache-2.0" },
          downloads: 5,
          likes: 2,
        }),
      ])
    );

    const results = await searchModels("cool-unique-query-1");
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.id).toBe("org/cool-7b");
    expect(r.name).toBe("cool-7b"); // last path segment
    expect(r.type).toBe("model");
    expect(r.description).toContain("Text Generation");
    expect(r.description).toContain("transformers");
    expect(r.description).toContain("apache-2.0 license");
    expect(r.description).toContain("by org");
    expect(r.estimatedParams).toBe(7);
  });

  it("builds query params including search, limit, sort and direction", async () => {
    mockFetch.mockResolvedValueOnce(okJson([]));
    await searchModels("query-2", { limit: 5, sort: "likes", direction: "asc" });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("search=query-2");
    expect(calledUrl).toContain("limit=5");
    expect(calledUrl).toContain("sort=likes");
    expect(calledUrl).toContain("direction=1"); // asc -> "1"
  });

  it("appends pipeline_tag and library filters", async () => {
    mockFetch.mockResolvedValueOnce(okJson([]));
    await searchModels("query-3", { filters: { task: "text-generation", library: "vllm" } });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("pipeline_tag=text-generation");
    expect(calledUrl).toContain("library=vllm");
  });

  it("filters by min/max params, keeping models with unknown params", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        makeModel({ id: "a/model-2b" }), // 2B
        makeModel({ id: "a/model-13b" }), // 13B
        makeModel({ id: "a/unknown" }), // undefined params -> kept
      ])
    );
    const results = await searchModels("query-4", { filters: { minParams: 1, maxParams: 7 } });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("a/model-2b");
    expect(ids).toContain("a/unknown"); // unknown is included
    expect(ids).not.toContain("a/model-13b");
  });

  it("returns [] and logs on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(errStatus(500));
    const results = await searchModels("query-5-fail");
    expect(results).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns [] when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const results = await searchModels("query-6-network");
    expect(results).toEqual([]);
  });

  it("serves a cached result without a second fetch", async () => {
    mockFetch.mockResolvedValueOnce(okJson([makeModel({ id: "c/cached-7b" })]));
    const first = await searchModels("cache-key-unique-7");
    const second = await searchModels("cache-key-unique-7");
    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("searchSpaces", () => {
  it("maps spaces with zero VRAM/disk and a derived description", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        { id: "org/space-x", author: "org", likes: 3, tags: ["demo"], gated: false, sdk: "streamlit" },
      ])
    );
    const results = await searchSpaces("space-query-1");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("space");
    expect(results[0].estimatedVramGb).toBe(0);
    expect(results[0].description).toBe("streamlit Space by org");
  });

  it("defaults the SDK label to Gradio when absent", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ id: "org/g", author: "org", likes: 1, tags: [], gated: false }]));
    const results = await searchSpaces("space-query-2");
    expect(results[0].description).toContain("Gradio Space");
  });

  it("returns [] on error", async () => {
    mockFetch.mockResolvedValueOnce(errStatus(503));
    expect(await searchSpaces("space-query-3-fail")).toEqual([]);
  });
});

describe("getModelInfo", () => {
  it("returns the parsed model on success", async () => {
    mockFetch.mockResolvedValueOnce(okJson(makeModel({ id: "org/info-model" })));
    const model = await getModelInfo("org/info-model");
    expect(model?.id).toBe("org/info-model");
  });

  it("returns null specifically on 404 (not a throw)", async () => {
    mockFetch.mockResolvedValueOnce(errStatus(404));
    expect(await getModelInfo("org/missing-1")).toBeNull();
  });

  it("returns null and logs on other error statuses", async () => {
    mockFetch.mockResolvedValueOnce(errStatus(500));
    expect(await getModelInfo("org/error-1")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("searchAll", () => {
  it("merges models and spaces and sorts by downloads + likes*10 desc", async () => {
    // searchModels fetch
    mockFetch.mockResolvedValueOnce(
      okJson([makeModel({ id: "m/low", downloads: 1, likes: 0 })])
    );
    // searchSpaces fetch
    mockFetch.mockResolvedValueOnce(
      okJson([{ id: "s/high", author: "s", likes: 50, tags: [], gated: false }])
    );
    const results = await searchAll("all-query-1", { limit: 10 });
    // space score = 0 + 50*10 = 500 ; model score = 1 -> space first
    expect(results[0].id).toBe("s/high");
    expect(results.map((r) => r.id)).toContain("m/low");
  });
});

describe("getPopularTextGenerationModels", () => {
  it("delegates to searchModels with a text-generation filter", async () => {
    mockFetch.mockResolvedValueOnce(okJson([makeModel({ id: "p/popular-7b" })]));
    const results = await getPopularTextGenerationModels(3);
    expect(results[0].id).toBe("p/popular-7b");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("filter=text-generation");
    expect(calledUrl).toContain("limit=3");
  });
});
