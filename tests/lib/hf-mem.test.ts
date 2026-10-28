// Deepening tests for src/lib/hf-mem.ts — the TS port of hf-mem. Exercises the
// REAL functions: the safetensors header parsing (range fetch + uint64 length),
// the dtype byte math, the VRAM estimate, and the formatters. Only `fetch` is
// mocked at the boundary; the module under test is imported for real.
//
// The metadata fetch reads the first 8 bytes as a little-endian uint64 length,
// then JSON-parses that many bytes of safetensors header. We build real
// ArrayBuffers so the parsing code runs end-to-end.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getModelMemory,
  formatBytes,
  formatParams,
  getDtypeDisplayName,
} from "@/lib/hf-mem";

const mockFetch = vi.fn();

// Build a safetensors-style range-response buffer: 8-byte LE length header
// followed by the JSON metadata, padded out so it "fits in the first request".
function safetensorsBuffer(metadata: Record<string, unknown>): ArrayBuffer {
  const json = JSON.stringify(metadata);
  const jsonBytes = new TextEncoder().encode(json);
  const total = 8 + jsonBytes.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt(jsonBytes.length), true); // LE length
  new Uint8Array(buf, 8).set(jsonBytes);
  return buf;
}

function rangeResponse(metadata: Record<string, unknown>) {
  return { status: 206, arrayBuffer: async () => safetensorsBuffer(metadata) };
}
function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => data };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatBytes", () => {
  it("formats GB / MB / KB / B with correct boundaries", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(3 * 1024)).toBe("3.00 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});

describe("formatParams", () => {
  it("formats billions / millions / thousands / raw", () => {
    expect(formatParams(7_240_000_000)).toBe("7.24B");
    expect(formatParams(125_000_000)).toBe("125.00M");
    expect(formatParams(2_500)).toBe("2.50K");
    expect(formatParams(42)).toBe("42");
  });
});

describe("getDtypeDisplayName", () => {
  it("maps known dtypes to friendly names", () => {
    expect(getDtypeDisplayName("F16")).toBe("float16");
    expect(getDtypeDisplayName("BF16")).toBe("bfloat16");
    expect(getDtypeDisplayName("F8_E4M3")).toBe("fp8 (E4M3)");
  });

  it("returns the raw dtype for unknown values", () => {
    expect(getDtypeDisplayName("Q4_0")).toBe("Q4_0");
  });
});

describe("getModelMemory — single safetensors file", () => {
  it("parses tensors, computes param/byte counts and VRAM with 20% overhead", async () => {
    // tree response: a single model.safetensors file
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ type: "file", path: "model.safetensors" }])
    );
    // 1,000,000 params in F16 (2 bytes) = 2,000,000 bytes
    mockFetch.mockResolvedValueOnce(
      rangeResponse({
        "weight.a": { dtype: "F16", shape: [1000, 1000] },
      })
    );

    const result = await getModelMemory("org/single-model");
    expect(result).not.toBeNull();
    expect(result!.totalParams).toBe(1_000_000);
    expect(result!.totalBytes).toBe(2_000_000);
    // 2_000_000 * 1.2 / 1024^3 ≈ 0.00223 GB -> rounded to 1 decimal = 0
    expect(result!.estimatedVramGb).toBe(0);
    expect(result!.components).toHaveLength(1);
    expect(result!.components[0].name).toBe("model");
    expect(result!.dtypeSummary[0].dtype).toBe("F16");
  });

  it("falls back to 2 bytes/param for an unknown dtype", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ type: "file", path: "model.safetensors" }]));
    mockFetch.mockResolvedValueOnce(
      rangeResponse({ t: { dtype: "MYSTERY", shape: [10, 10] } }) // 100 params
    );
    const result = await getModelMemory("org/unknown-dtype");
    expect(result!.totalParams).toBe(100);
    expect(result!.totalBytes).toBe(200); // 100 * 2 (fallback)
  });

  it("skips the __metadata__ key and tensors missing dtype/shape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ type: "file", path: "model.safetensors" }]));
    mockFetch.mockResolvedValueOnce(
      rangeResponse({
        __metadata__: { format: "pt" },
        good: { dtype: "F32", shape: [10] }, // 10 params * 4 bytes
        bad_no_shape: { dtype: "F32" },
      })
    );
    const result = await getModelMemory("org/has-metadata");
    expect(result!.totalParams).toBe(10);
    expect(result!.totalBytes).toBe(40);
  });

  it("produces a meaningful VRAM number for a large model", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ type: "file", path: "model.safetensors" }]));
    // ~7B params in BF16 (2 bytes) shaped as one big tensor
    mockFetch.mockResolvedValueOnce(
      rangeResponse({ w: { dtype: "BF16", shape: [7_000_000_000] } })
    );
    const result = await getModelMemory("org/big-7b");
    // 7e9 * 2 = 1.4e10 bytes; *1.2 / 1024^3 ≈ 15.6 -> rounds to 15.6
    expect(result!.totalBytes).toBe(14_000_000_000);
    expect(result!.estimatedVramGb).toBeGreaterThan(15);
    expect(result!.estimatedVramGb).toBeLessThan(16.5);
  });
});

describe("getModelMemory — sharded safetensors", () => {
  it("reads the index, dedupes shard files, and merges their metadata", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { type: "file", path: "model.safetensors.index.json" },
        { type: "file", path: "shard-1.safetensors" },
        { type: "file", path: "shard-2.safetensors" },
      ])
    );
    // index.json — weight_map references two shards (with a duplicate ref)
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        weight_map: { "a": "shard-1.safetensors", "b": "shard-1.safetensors", "c": "shard-2.safetensors" },
      })
    );
    // metadata for shard-1 and shard-2 (Promise.all order matches dedup order)
    mockFetch.mockResolvedValueOnce(rangeResponse({ "a": { dtype: "F16", shape: [100] } }));
    mockFetch.mockResolvedValueOnce(rangeResponse({ "c": { dtype: "F16", shape: [200] } }));

    const result = await getModelMemory("org/sharded");
    expect(result!.totalParams).toBe(300); // 100 + 200
    // Only 2 unique shards fetched (deduped), plus tree + index = 4 fetches
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("getModelMemory — error and empty paths", () => {
  it("returns null when the file tree fetch is not ok", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false));
    expect(await getModelMemory("org/no-tree")).toBeNull();
  });

  it("returns null when no safetensors files exist at all", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ type: "file", path: "config.json" }, { type: "file", path: "pytorch_model.bin" }])
    );
    expect(await getModelMemory("org/no-safetensors")).toBeNull();
  });

  it("falls back to the first loose .safetensors file when no known index exists", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ type: "file", path: "weights-only.safetensors" }])
    );
    mockFetch.mockResolvedValueOnce(rangeResponse({ w: { dtype: "F32", shape: [5] } }));
    const result = await getModelMemory("org/loose");
    expect(result!.totalParams).toBe(5);
  });

  it("returns null when the metadata range request itself fails (non-206/200)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ type: "file", path: "model.safetensors" }]));
    mockFetch.mockResolvedValueOnce({ status: 416, arrayBuffer: async () => new ArrayBuffer(0) });
    // metadata fetch returns null -> rawMetadata empty -> overall null
    expect(await getModelMemory("org/range-fail")).toBeNull();
  });

  it("returns null when the tree fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    expect(await getModelMemory("org/throws")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("sends an Authorization header when an HF token is supplied", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ type: "file", path: "model.safetensors" }]));
    mockFetch.mockResolvedValueOnce(rangeResponse({ w: { dtype: "F16", shape: [4] } }));
    await getModelMemory("org/gated", "main", "hf_secret");
    const treeCall = mockFetch.mock.calls[0];
    expect((treeCall[1].headers as Record<string, string>)["Authorization"]).toBe("Bearer hf_secret");
  });
});
