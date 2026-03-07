/**
 * HuggingFace Memory Estimator
 * TypeScript port of https://github.com/alvarobartt/hf-mem
 *
 * Calculates actual VRAM requirements by parsing safetensors metadata
 * using HTTP Range requests (no need to download full model weights)
 */

const MAX_METADATA_SIZE = 100_000;
const REQUEST_TIMEOUT = 10_000;

// Safetensors data types and their byte sizes
const DTYPE_BYTES: Record<string, number> = {
  "F64": 8, "I64": 8, "U64": 8,
  "F32": 4, "I32": 4, "U32": 4,
  "F16": 2, "BF16": 2, "I16": 2, "U16": 2,
  "F8_E5M2": 1, "F8_E4M3": 1, "I8": 1, "U8": 1,
  // Quantized types (approximations)
  "Q4_0": 0.5, "Q4_1": 0.5, "Q5_0": 0.625, "Q5_1": 0.625,
  "Q8_0": 1, "Q8_1": 1,
};

export interface DtypeBreakdown {
  dtype: string;
  paramCount: number;
  bytesCount: number;
}

export interface ComponentBreakdown {
  name: string;
  dtypes: DtypeBreakdown[];
  paramCount: number;
  bytesCount: number;
}

export interface HfMemResult {
  modelId: string;
  components: ComponentBreakdown[];
  totalParams: number;
  totalBytes: number;
  estimatedVramGb: number;
  dtypeSummary: DtypeBreakdown[];
}

interface SafetensorsMetadata {
  [key: string]: {
    dtype: string;
    shape: number[];
    data_offsets?: [number, number];
  } | { [key: string]: string }; // __metadata__ field
}

/**
 * Fetch safetensors metadata using HTTP Range request
 * Only downloads the header, not the full model weights
 */
async function fetchSafetensorsMetadata(
  url: string,
  headers?: Record<string, string>
): Promise<SafetensorsMetadata | null> {
  const fetchHeaders: Record<string, string> = {
    "Range": `bytes=0-${MAX_METADATA_SIZE}`,
    ...headers,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      headers: fetchHeaders,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status !== 206 && response.status !== 200) {
      console.error(`Range request failed: ${response.status} for ${url}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);

    // First 8 bytes = little-endian uint64 (metadata size)
    const metadataSize = Number(view.getBigUint64(0, true));

    let metadataBuffer: Uint8Array;

    if (metadataSize <= MAX_METADATA_SIZE - 8) {
      // Metadata fits in first request
      metadataBuffer = new Uint8Array(buffer, 8, metadataSize);
    } else {
      // Need to fetch the rest of the metadata
      const remainingHeaders: Record<string, string> = {
        "Range": `bytes=${MAX_METADATA_SIZE + 1}-${metadataSize + 7}`,
        ...headers,
      };

      const remainingResponse = await fetch(url, { headers: remainingHeaders });
      const remainingBuffer = await remainingResponse.arrayBuffer();

      // Combine buffers
      const firstPart = new Uint8Array(buffer, 8, MAX_METADATA_SIZE - 8);
      const secondPart = new Uint8Array(remainingBuffer);
      metadataBuffer = new Uint8Array(metadataSize);
      metadataBuffer.set(firstPart, 0);
      metadataBuffer.set(secondPart, firstPart.length);
    }

    const decoder = new TextDecoder();
    const metadataJson = decoder.decode(metadataBuffer);
    return JSON.parse(metadataJson);
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`Request timeout for ${url}`);
    } else {
      console.error(`Error fetching metadata: ${error}`);
    }
    return null;
  }
}

/**
 * Parse safetensors metadata and calculate memory requirements
 */
function parseMetadata(
  rawMetadata: Record<string, SafetensorsMetadata>,
): { components: ComponentBreakdown[]; totalParams: number; totalBytes: number } {
  const components: ComponentBreakdown[] = [];
  let totalParams = 0;
  let totalBytes = 0;

  for (const [componentName, metadata] of Object.entries(rawMetadata)) {
    const dtypeMap = new Map<string, { params: number; bytes: number }>();
    let componentParams = 0;
    let componentBytes = 0;

    for (const [key, value] of Object.entries(metadata)) {
      if (key === "__metadata__") continue;

      const tensor = value as { dtype: string; shape: number[] };
      if (!tensor.dtype || !tensor.shape) continue;

      const params = tensor.shape.reduce((a, b) => a * b, 1);
      const bytesPerParam = DTYPE_BYTES[tensor.dtype] ?? 2;
      const bytes = params * bytesPerParam;

      const existing = dtypeMap.get(tensor.dtype) || { params: 0, bytes: 0 };
      dtypeMap.set(tensor.dtype, {
        params: existing.params + params,
        bytes: existing.bytes + bytes,
      });

      componentParams += params;
      componentBytes += bytes;
    }

    const dtypes: DtypeBreakdown[] = Array.from(dtypeMap.entries()).map(
      ([dtype, counts]) => ({
        dtype,
        paramCount: counts.params,
        bytesCount: counts.bytes,
      })
    );

    components.push({
      name: componentName,
      dtypes,
      paramCount: componentParams,
      bytesCount: componentBytes,
    });

    totalParams += componentParams;
    totalBytes += componentBytes;
  }

  return { components, totalParams, totalBytes };
}

/**
 * Get memory estimate for a HuggingFace model
 */
export async function getModelMemory(
  modelId: string,
  revision: string = "main",
  hfToken?: string,
): Promise<HfMemResult | null> {
  const headers: Record<string, string> = {};
  if (hfToken) {
    headers["Authorization"] = `Bearer ${hfToken}`;
  }

  try {
    // Step 1: Get file tree
    const treeUrl = `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=true`;
    const treeResponse = await fetch(treeUrl, { headers });

    if (!treeResponse.ok) {
      console.error(`Failed to fetch model tree: ${treeResponse.status}`);
      return null;
    }

    const files = await treeResponse.json();
    const filePaths: string[] = files
      .filter((f: { type: string }) => f.type === "file")
      .map((f: { path: string }) => f.path);

    const rawMetadata: Record<string, SafetensorsMetadata> = {};
    const baseUrl = `https://huggingface.co/${modelId}/resolve/${revision}`;

    // Step 2: Determine model type and fetch metadata
    if (filePaths.includes("model.safetensors")) {
      // Single safetensors file
      const metadata = await fetchSafetensorsMetadata(
        `${baseUrl}/model.safetensors`,
        headers
      );
      if (metadata) {
        rawMetadata["model"] = metadata;
      }
    } else if (filePaths.includes("model.safetensors.index.json")) {
      // Sharded safetensors
      const indexResponse = await fetch(
        `${baseUrl}/model.safetensors.index.json`,
        { headers }
      );
      const index = await indexResponse.json();
      const shardFiles = [...new Set(Object.values(index.weight_map))] as string[];

      // Fetch metadata from all shards in parallel
      const metadataPromises = shardFiles.map((shard) =>
        fetchSafetensorsMetadata(`${baseUrl}/${shard}`, headers)
      );
      const metadataResults = await Promise.all(metadataPromises);

      // Merge all shard metadata
      const mergedMetadata: SafetensorsMetadata = {};
      for (const metadata of metadataResults) {
        if (metadata) {
          Object.assign(mergedMetadata, metadata);
        }
      }
      rawMetadata["model"] = mergedMetadata;
    } else if (filePaths.includes("model_index.json")) {
      // Diffusers model
      const indexResponse = await fetch(`${baseUrl}/model_index.json`, { headers });
      const index = await indexResponse.json();

      for (const [componentName, componentConfig] of Object.entries(index)) {
        if (componentName.startsWith("_")) continue;

        // Try different safetensors file patterns
        const patterns = [
          `${componentName}/diffusion_pytorch_model.safetensors`,
          `${componentName}/model.safetensors`,
        ];

        for (const pattern of patterns) {
          if (filePaths.includes(pattern)) {
            const metadata = await fetchSafetensorsMetadata(
              `${baseUrl}/${pattern}`,
              headers
            );
            if (metadata) {
              rawMetadata[componentName] = metadata;
            }
            break;
          }
        }

        // Check for sharded component
        const shardedPatterns = [
          `${componentName}/diffusion_pytorch_model.safetensors.index.json`,
          `${componentName}/model.safetensors.index.json`,
        ];

        for (const pattern of shardedPatterns) {
          if (filePaths.includes(pattern)) {
            const shardIndexResponse = await fetch(`${baseUrl}/${pattern}`, { headers });
            const shardIndex = await shardIndexResponse.json();
            const shardFiles = [...new Set(Object.values(shardIndex.weight_map))] as string[];

            const mergedMetadata: SafetensorsMetadata = {};
            for (const shard of shardFiles) {
              const shardPath = `${componentName}/${shard}`;
              const metadata = await fetchSafetensorsMetadata(
                `${baseUrl}/${shardPath}`,
                headers
              );
              if (metadata) {
                Object.assign(mergedMetadata, metadata);
              }
            }
            rawMetadata[componentName] = mergedMetadata;
            break;
          }
        }
      }
    } else {
      // Try to find any safetensors files
      const safetensorsFiles = filePaths.filter(
        (p: string) => p.endsWith(".safetensors") && !p.includes(".index.json")
      );

      if (safetensorsFiles.length === 0) {
        console.error("No safetensors files found");
        return null;
      }

      // Fetch first safetensors file as fallback
      const metadata = await fetchSafetensorsMetadata(
        `${baseUrl}/${safetensorsFiles[0]}`,
        headers
      );
      if (metadata) {
        rawMetadata["model"] = metadata;
      }
    }

    if (Object.keys(rawMetadata).length === 0) {
      console.error("Could not fetch any metadata");
      return null;
    }

    // Step 3: Parse and calculate
    const { components, totalParams, totalBytes } = parseMetadata(rawMetadata);

    // Create dtype summary across all components
    const dtypeSummaryMap = new Map<string, { params: number; bytes: number }>();
    for (const component of components) {
      for (const dtype of component.dtypes) {
        const existing = dtypeSummaryMap.get(dtype.dtype) || { params: 0, bytes: 0 };
        dtypeSummaryMap.set(dtype.dtype, {
          params: existing.params + dtype.paramCount,
          bytes: existing.bytes + dtype.bytesCount,
        });
      }
    }

    const dtypeSummary: DtypeBreakdown[] = Array.from(dtypeSummaryMap.entries())
      .map(([dtype, counts]) => ({
        dtype,
        paramCount: counts.params,
        bytesCount: counts.bytes,
      }))
      .sort((a, b) => b.bytesCount - a.bytesCount);

    // Add 20% overhead for inference (KV cache, activations, etc.)
    const estimatedVramGb = (totalBytes * 1.2) / (1024 * 1024 * 1024);

    return {
      modelId,
      components,
      totalParams,
      totalBytes,
      estimatedVramGb: Math.round(estimatedVramGb * 10) / 10,
      dtypeSummary,
    };
  } catch (error) {
    console.error(`Error getting model memory: ${error}`);
    return null;
  }
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Format parameter count to human readable string
 */
export function formatParams(params: number): string {
  if (params >= 1_000_000_000) {
    return `${(params / 1_000_000_000).toFixed(2)}B`;
  }
  if (params >= 1_000_000) {
    return `${(params / 1_000_000).toFixed(2)}M`;
  }
  if (params >= 1_000) {
    return `${(params / 1_000).toFixed(2)}K`;
  }
  return `${params}`;
}

/**
 * Get dtype display name
 */
export function getDtypeDisplayName(dtype: string): string {
  const names: Record<string, string> = {
    "F64": "float64",
    "F32": "float32",
    "F16": "float16",
    "BF16": "bfloat16",
    "I64": "int64",
    "I32": "int32",
    "I16": "int16",
    "I8": "int8",
    "U64": "uint64",
    "U32": "uint32",
    "U16": "uint16",
    "U8": "uint8",
    "F8_E5M2": "fp8 (E5M2)",
    "F8_E4M3": "fp8 (E4M3)",
  };
  return names[dtype] || dtype;
}
