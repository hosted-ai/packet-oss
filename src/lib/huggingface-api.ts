/**
 * Hugging Face Hub API client
 * For searching models, spaces, and getting model info
 */

const HF_API_BASE = "https://huggingface.co/api";

// Cache for API responses
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_SEARCH = 5 * 60 * 1000; // 5 minutes for search
const CACHE_TTL_MODEL = 60 * 60 * 1000; // 1 hour for model info

function getCached<T>(key: string, ttl: number): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export interface HFModel {
  id: string;
  modelId: string;
  author: string;
  sha: string;
  lastModified: string;
  private: boolean;
  gated: boolean | "auto" | "manual";
  disabled: boolean;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag?: string;
  library_name?: string;
  createdAt: string;
  cardData?: {
    license?: string;
    language?: string[];
    tags?: string[];
  };
  siblings?: Array<{
    rfilename: string;
    size?: number;
  }>;
  safetensors?: {
    total?: number;
    parameters?: {
      [key: string]: number;
    };
  };
}

export interface HFSpace {
  id: string;
  author: string;
  sha: string;
  lastModified: string;
  private: boolean;
  gated: boolean;
  disabled: boolean;
  likes: number;
  tags: string[];
  createdAt: string;
  sdk?: string;
  hardware?: string;
}

export interface HFSearchResult {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  likes: number;
  gated: boolean;
  tags: string[];
  pipelineTag?: string;
  libraryName?: string;
  estimatedVramGb: number;
  estimatedParams?: number; // Parameter count in billions
  type: "model" | "space";
}

// Filter options for searching models
export interface ModelSearchFilters {
  task?: string;           // pipeline_tag: text-generation, image-to-text, etc.
  library?: string;        // library_name: transformers, diffusers, etc.
  minParams?: number;      // minimum parameter count in billions
  maxParams?: number;      // maximum parameter count in billions
}

// Available task filters
export const TASK_FILTERS = [
  { value: "text-generation", label: "Text Generation" },
  { value: "text2text-generation", label: "Text-to-Text" },
  { value: "image-text-to-text", label: "Image-Text-to-Text" },
  { value: "image-to-text", label: "Image-to-Text" },
  { value: "text-to-image", label: "Text-to-Image" },
  { value: "text-to-video", label: "Text-to-Video" },
  { value: "text-to-speech", label: "Text-to-Speech" },
  { value: "automatic-speech-recognition", label: "Speech Recognition" },
  { value: "conversational", label: "Conversational" },
] as const;

// Available library filters (most relevant for GPU deployment)
export const LIBRARY_FILTERS = [
  { value: "transformers", label: "Transformers" },
  { value: "diffusers", label: "Diffusers" },
  { value: "safetensors", label: "Safetensors" },
  { value: "gguf", label: "GGUF" },
  { value: "vllm", label: "vLLM" },
] as const;

// Parameter size ranges in billions
export const PARAM_SIZE_RANGES = [
  { value: "0-1", label: "< 1B", min: 0, max: 1 },
  { value: "1-3", label: "1-3B", min: 1, max: 3 },
  { value: "3-7", label: "3-7B", min: 3, max: 7 },
  { value: "7-14", label: "7-14B", min: 7, max: 14 },
  { value: "14-32", label: "14-32B", min: 14, max: 32 },
  { value: "32-70", label: "32-70B", min: 32, max: 70 },
  { value: "70-200", label: "70-200B", min: 70, max: 200 },
  { value: "200+", label: "> 200B", min: 200, max: Infinity },
] as const;

/**
 * Search Hugging Face models
 */
export async function searchModels(
  query: string,
  options: {
    limit?: number;
    filter?: string;
    filters?: ModelSearchFilters;
    sort?: "downloads" | "likes" | "lastModified";
    direction?: "asc" | "desc";
  } = {}
): Promise<HFSearchResult[]> {
  const { limit = 20, filter, filters, sort = "downloads", direction = "desc" } = options;

  const cacheKey = `models:${query}:${limit}:${filter}:${JSON.stringify(filters)}:${sort}:${direction}`;
  const cached = getCached<HFSearchResult[]>(cacheKey, CACHE_TTL_SEARCH);
  if (cached) return cached;

  const params = new URLSearchParams({
    search: query,
    limit: String(limit),
    sort: sort,
    direction: direction === "asc" ? "1" : "-1",
    full: "true",
  });

  // Apply legacy filter
  if (filter) {
    params.append("filter", filter);
  }

  // Apply new filters
  if (filters?.task) {
    params.append("pipeline_tag", filters.task);
  }
  if (filters?.library) {
    params.append("library", filters.library);
  }

  try {
    const response = await fetch(`${HF_API_BASE}/models?${params}`);
    if (!response.ok) {
      throw new Error(`HF API error: ${response.status}`);
    }

    const models: HFModel[] = await response.json();
    let results = models.map((model) => ({
      id: model.id,
      name: model.id.split("/").pop() || model.id,
      description: getModelDescription(model),
      author: model.author,
      downloads: model.downloads,
      likes: model.likes,
      gated: typeof model.gated === "boolean" ? model.gated : Boolean(model.gated),
      tags: model.tags || [],
      pipelineTag: model.pipeline_tag,
      libraryName: model.library_name,
      estimatedVramGb: estimateVramFromModel(model),
      estimatedParams: estimateParamsFromModel(model),
      type: "model" as const,
    }));

    // Apply parameter size filter (HF API doesn't support this directly)
    if (filters?.minParams !== undefined || filters?.maxParams !== undefined) {
      results = results.filter((r) => {
        if (!r.estimatedParams) return true; // Include if unknown
        const params = r.estimatedParams;
        const min = filters.minParams ?? 0;
        const max = filters.maxParams ?? Infinity;
        return params >= min && params <= max;
      });
    }

    setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("Error searching HF models:", error);
    return [];
  }
}

/**
 * Search Hugging Face spaces
 */
export async function searchSpaces(
  query: string,
  options: {
    limit?: number;
    sort?: "likes" | "lastModified";
  } = {}
): Promise<HFSearchResult[]> {
  const { limit = 20, sort = "likes" } = options;

  const cacheKey = `spaces:${query}:${limit}:${sort}`;
  const cached = getCached<HFSearchResult[]>(cacheKey, CACHE_TTL_SEARCH);
  if (cached) return cached;

  const params = new URLSearchParams({
    search: query,
    limit: String(limit),
    sort: sort,
    direction: "-1",
    full: "true",
  });

  try {
    const response = await fetch(`${HF_API_BASE}/spaces?${params}`);
    if (!response.ok) {
      throw new Error(`HF API error: ${response.status}`);
    }

    const spaces: HFSpace[] = await response.json();
    const results = spaces.map((space) => ({
      id: space.id,
      name: space.id.split("/").pop() || space.id,
      description: `${space.sdk || "Gradio"} Space by ${space.author}`,
      author: space.author,
      downloads: 0,
      likes: space.likes,
      gated: space.gated,
      tags: space.tags || [],
      estimatedVramGb: 0, // Spaces VRAM depends on what they run
      type: "space" as const,
    }));

    setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("Error searching HF spaces:", error);
    return [];
  }
}

/**
 * Get detailed model information
 */
export async function getModelInfo(modelId: string): Promise<HFModel | null> {
  const cacheKey = `model:${modelId}`;
  const cached = getCached<HFModel>(cacheKey, CACHE_TTL_MODEL);
  if (cached) return cached;

  try {
    const response = await fetch(`${HF_API_BASE}/models/${modelId}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HF API error: ${response.status}`);
    }

    const model: HFModel = await response.json();
    setCache(cacheKey, model);
    return model;
  } catch (error) {
    console.error("Error fetching model info:", error);
    return null;
  }
}

/**
 * Check if a model requires gated access
 */
export function isGatedModel(model: HFModel | HFSearchResult): boolean {
  if ("gated" in model) {
    return typeof model.gated === "boolean" ? model.gated : Boolean(model.gated);
  }
  return false;
}

/**
 * Extract a description from model metadata
 */
function getModelDescription(model: HFModel): string {
  const parts: string[] = [];

  if (model.pipeline_tag) {
    parts.push(formatPipelineTag(model.pipeline_tag));
  }

  if (model.library_name) {
    parts.push(`${model.library_name}`);
  }

  if (model.cardData?.license) {
    parts.push(`${model.cardData.license} license`);
  }

  if (parts.length === 0) {
    parts.push("Model");
  }

  parts.push(`by ${model.author}`);

  return parts.join(" - ");
}

/**
 * Format pipeline tag for display
 */
function formatPipelineTag(tag: string): string {
  const tagMap: Record<string, string> = {
    "text-generation": "Text Generation",
    "text2text-generation": "Text-to-Text",
    "fill-mask": "Fill Mask",
    "token-classification": "Token Classification",
    "text-classification": "Text Classification",
    "question-answering": "Question Answering",
    "summarization": "Summarization",
    "translation": "Translation",
    "conversational": "Conversational",
    "image-classification": "Image Classification",
    "object-detection": "Object Detection",
    "image-segmentation": "Image Segmentation",
    "text-to-image": "Text-to-Image",
    "image-to-text": "Image-to-Text",
    "automatic-speech-recognition": "Speech Recognition",
    "audio-classification": "Audio Classification",
    "text-to-speech": "Text-to-Speech",
    "text-to-audio": "Text-to-Audio",
  };

  return tagMap[tag] || tag.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Estimate VRAM requirement from model metadata
 * Uses parameter count and data type to estimate
 */
export function estimateVramFromModel(model: HFModel): number {
  // Check safetensors metadata for parameter count
  if (model.safetensors?.parameters) {
    const params = Object.values(model.safetensors.parameters).reduce(
      (sum, count) => sum + count,
      0
    );
    // Rough estimate: 2 bytes per parameter (fp16) + 20% overhead
    const vramBytes = params * 2 * 1.2;
    return Math.ceil(vramBytes / (1024 * 1024 * 1024));
  }

  // Check file sizes for approximate size
  if (model.siblings && model.siblings.length > 0) {
    const totalSize = model.siblings
      .filter(
        (s) =>
          s.rfilename.endsWith(".safetensors") ||
          s.rfilename.endsWith(".bin") ||
          s.rfilename.endsWith(".pt")
      )
      .reduce((sum, s) => sum + (s.size || 0), 0);

    if (totalSize > 0) {
      // Model files are weights, add 20% overhead for inference
      const vramGb = Math.ceil((totalSize * 1.2) / (1024 * 1024 * 1024));
      return vramGb;
    }
  }

  // Parse common model size patterns from name
  const name = model.id.toLowerCase();

  // Extract parameter count from name patterns like "7b", "70b", "405b"
  const paramMatch = name.match(/(\d+(?:\.\d+)?)\s*b(?:illion)?/i);
  if (paramMatch) {
    const params = parseFloat(paramMatch[1]);
    // Rough: 2 bytes per param (fp16) + overhead
    return Math.ceil(params * 2 * 1.2);
  }

  // Default - unknown
  return 0;
}

/**
 * Estimate parameter count in billions from model metadata
 */
export function estimateParamsFromModel(model: HFModel): number | undefined {
  // Check safetensors metadata for parameter count
  if (model.safetensors?.parameters) {
    const params = Object.values(model.safetensors.parameters).reduce(
      (sum, count) => sum + count,
      0
    );
    // Convert to billions
    return Math.round(params / 1_000_000_000 * 10) / 10;
  }

  // Parse common model size patterns from name
  const name = model.id.toLowerCase();

  // Extract parameter count from name patterns like "7b", "70b", "405b", "1.5b"
  const paramMatch = name.match(/(\d+(?:\.\d+)?)\s*b(?:illion)?(?![a-z])/i);
  if (paramMatch) {
    return parseFloat(paramMatch[1]);
  }

  // Check for million parameter models
  const millionMatch = name.match(/(\d+(?:\.\d+)?)\s*m(?:illion)?(?![a-z])/i);
  if (millionMatch) {
    return parseFloat(millionMatch[1]) / 1000;
  }

  return undefined;
}

/**
 * Search both models and spaces
 */
export async function searchAll(
  query: string,
  options: { limit?: number } = {}
): Promise<HFSearchResult[]> {
  const { limit = 20 } = options;
  const halfLimit = Math.ceil(limit / 2);

  const [models, spaces] = await Promise.all([
    searchModels(query, { limit: halfLimit }),
    searchSpaces(query, { limit: halfLimit }),
  ]);

  // Interleave results, prioritizing by downloads/likes
  const results = [...models, ...spaces].sort(
    (a, b) => b.downloads + b.likes * 10 - (a.downloads + a.likes * 10)
  );

  return results.slice(0, limit);
}

/**
 * Get popular text generation models
 */
export async function getPopularTextGenerationModels(
  limit: number = 10
): Promise<HFSearchResult[]> {
  return searchModels("", {
    limit,
    filter: "text-generation",
    sort: "downloads",
  });
}
