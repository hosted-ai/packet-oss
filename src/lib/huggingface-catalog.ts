/**
 * Curated Hugging Face catalog for GPU cloud platform
 * Contains popular models, Docker images, and Spaces templates
 */

export type HFItemType = "model" | "docker" | "space";
export type DeployScriptType = "tgi" | "vllm" | "docker" | "space" | "ollama";

export interface HFCatalogItem {
  id: string;
  type: HFItemType;
  name: string;
  description: string;
  vramGb: number; // Required VRAM in GB (0 = any GPU works)
  deployScript: DeployScriptType;
  dockerImage?: string;
  tags: string[];
  gated: boolean; // Requires HF token
  featured?: boolean;
  downloads?: number; // Approximate download count for sorting
  hasWebUI?: boolean; // Whether deployment includes a web interface
  webUIPort?: number; // Port for web UI (if different from service port)
  logo?: string; // URL to logo image
  provider?: string; // Company/org that created it (Meta, Mistral, Google, etc.)
}

export const HF_CATALOG: {
  popular: HFCatalogItem[];
  rtxOptimized: HFCatalogItem[]; // RTX 4090/4080 optimized (up to 24GB VRAM)
  models: HFCatalogItem[];
  docker: HFCatalogItem[];
  spaces: HFCatalogItem[];
} = {
  // Pro 6000 Blackwell optimized models (≤96GB VRAM)
  rtxOptimized: [
    {
      id: "meta-llama/Llama-3.1-70B-Instruct",
      type: "model",
      name: "Llama 3.1 70B Instruct",
      description: "Meta's flagship 70B model. Runs in FP8 on Pro 6000 Blackwell's 96GB VRAM. State-of-the-art reasoning and coding.",
      vramGb: 80,
      deployScript: "vllm",
      tags: ["llm", "chat", "meta", "70B", "blackwell"],
      gated: true,
      featured: true,
      downloads: 5000000,
      logo: "https://huggingface.co/meta-llama/resolve/main/Llama3.png",
      provider: "Meta",
    },
    {
      id: "Qwen/Qwen2.5-72B-Instruct",
      type: "model",
      name: "Qwen 2.5 72B Instruct",
      description: "Alibaba's 72B model. Runs in FP8 on Pro 6000 Blackwell's 96GB VRAM. Excellent at coding, math, and multilingual tasks.",
      vramGb: 82,
      deployScript: "vllm",
      tags: ["llm", "chat", "qwen", "72B", "blackwell"],
      gated: false,
      featured: true,
      downloads: 3000000,
      logo: "https://huggingface.co/Qwen/resolve/main/assets/qwen2.5_logo.jpeg",
      provider: "Alibaba",
    },
    {
      id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
      type: "model",
      name: "DeepSeek R1 Distill 32B",
      description: "DeepSeek R1 reasoning distilled into 32B model. Exceptional at math and complex reasoning. ~65GB VRAM in FP16.",
      vramGb: 65,
      deployScript: "vllm",
      tags: ["llm", "reasoning", "deepseek", "32B", "blackwell"],
      gated: false,
      featured: true,
      downloads: 2500000,
      logo: "https://huggingface.co/deepseek-ai/resolve/main/logo.png",
      provider: "DeepSeek",
    },
    {
      id: "google/gemma-2-27b-it",
      type: "model",
      name: "Gemma 2 27B Instruct",
      description: "Google's larger Gemma model. Enhanced reasoning and creative capabilities. ~55GB VRAM in FP16.",
      vramGb: 55,
      deployScript: "vllm",
      tags: ["llm", "chat", "google", "gemma", "27B", "blackwell"],
      gated: true,
      featured: true,
      downloads: 3000000,
      logo: "https://huggingface.co/google/resolve/main/gemma_logo.png",
      provider: "Google",
    },
    {
      id: "meta-llama/Llama-3.1-8B-Instruct",
      type: "model",
      name: "Llama 3.1 8B Instruct",
      description: "Meta's efficient 8B model. Fits easily with room for large context windows. 128K context support.",
      vramGb: 16,
      deployScript: "vllm",
      tags: ["llm", "chat", "meta", "8B", "fast", "blackwell"],
      gated: true,
      featured: true,
      downloads: 10000000,
      logo: "https://huggingface.co/meta-llama/resolve/main/Llama3.png",
      provider: "Meta",
    },
    {
      id: "Qwen/Qwen2.5-32B-Instruct",
      type: "model",
      name: "Qwen 2.5 32B Instruct",
      description: "Alibaba's 32B model. Strong at coding and structured tasks. ~65GB VRAM in FP16.",
      vramGb: 65,
      deployScript: "vllm",
      tags: ["llm", "chat", "qwen", "32B", "blackwell"],
      gated: false,
      featured: true,
      downloads: 2000000,
      logo: "https://huggingface.co/Qwen/resolve/main/assets/qwen2.5_logo.jpeg",
      provider: "Alibaba",
    },
    {
      id: "NousResearch/Hermes-3-Llama-3.1-8B",
      type: "model",
      name: "Hermes 3 Llama 3.1 8B",
      description: "Fine-tuned Llama 3.1 8B with enhanced instruction following and function calling.",
      vramGb: 16,
      deployScript: "vllm",
      tags: ["llm", "chat", "nous", "instruction", "blackwell"],
      gated: false,
      featured: true,
      downloads: 1500000,
      logo: "https://huggingface.co/NousResearch/resolve/main/nous-logo.png",
      provider: "Nous Research",
    },
    {
      id: "mistralai/Mistral-7B-Instruct-v0.3",
      type: "model",
      name: "Mistral 7B Instruct v0.3",
      description: "Mistral's latest 7B. Apache 2.0 licensed. Fast inference with room for large batches.",
      vramGb: 14,
      deployScript: "vllm",
      tags: ["llm", "chat", "mistral", "open-source", "fast", "blackwell"],
      gated: false,
      featured: true,
      downloads: 8000000,
      logo: "https://huggingface.co/mistralai/resolve/main/mistral-logo.png",
      provider: "Mistral AI",
    },
    {
      id: "microsoft/Phi-3.5-mini-instruct",
      type: "model",
      name: "Phi 3.5 Mini Instruct",
      description: "Microsoft's compact 3.8B punching above its weight. Perfect for high-throughput inference.",
      vramGb: 8,
      deployScript: "vllm",
      tags: ["llm", "chat", "microsoft", "small", "fast", "blackwell"],
      gated: false,
      featured: true,
      downloads: 4000000,
      logo: "https://huggingface.co/microsoft/resolve/main/phi-logo.png",
      provider: "Microsoft",
    },
    {
      id: "TheBloke/Llama-2-70B-Chat-AWQ",
      type: "model",
      name: "Llama 2 70B Chat AWQ",
      description: "4-bit AWQ quantized Llama 2 70B. Fits comfortably in 48GB. Great for production workloads.",
      vramGb: 40,
      deployScript: "vllm",
      tags: ["llm", "chat", "quantized", "awq", "70B", "blackwell"],
      gated: false,
      featured: true,
      downloads: 800000,
      logo: "https://huggingface.co/meta-llama/resolve/main/Llama3.png",
      provider: "TheBloke",
    },
  ],

  // Featured/Popular items shown on main tab
  popular: [
    {
      id: "meta-llama/Llama-3.1-8B-Instruct",
      type: "model",
      name: "Llama 3.1 8B Instruct",
      description: "Meta's latest 8B parameter instruction-tuned LLM. Excellent for chat, summarization, and general text tasks. Supports 128K context window.",
      vramGb: 16,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "meta", "instruction-following"],
      gated: true,
      featured: true,
      downloads: 10000000,
      logo: "https://huggingface.co/meta-llama/resolve/main/Llama3.png",
      provider: "Meta",
    },
    {
      id: "mistralai/Mistral-7B-Instruct-v0.3",
      type: "model",
      name: "Mistral 7B Instruct v0.3",
      description: "Compact yet powerful 7B model from Mistral AI. Apache 2.0 licensed, great balance of speed and capability. Ideal for production deployments.",
      vramGb: 14,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "mistral", "open-source"],
      gated: false,
      featured: true,
      downloads: 8000000,
      logo: "https://huggingface.co/mistralai/resolve/main/mistral-logo.png",
      provider: "Mistral AI",
    },
    {
      id: "nvidia/pytorch:24.08-py3",
      type: "docker",
      name: "NVIDIA PyTorch Container",
      description: "Official NVIDIA NGC container with PyTorch 2.4, CUDA 12.4, cuDNN 9, and TensorRT. Optimized for A100/H100 GPUs.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "nvcr.io/nvidia/pytorch:24.08-py3",
      tags: ["pytorch", "nvidia", "development", "cuda"],
      gated: false,
      featured: true,
      hasWebUI: false,
      logo: "https://www.nvidia.com/content/dam/en-zz/Solutions/about-nvidia/logo-and-brand/02-nvidia-logo-color-grn-500x200-4c25-p@2x.png",
      provider: "NVIDIA",
    },
  ],

  // LLM Models
  models: [
    {
      id: "meta-llama/Llama-3.1-8B-Instruct",
      type: "model",
      name: "Llama 3.1 8B Instruct",
      description: "Meta's latest 8B parameter instruction-tuned LLM. Excellent for chat, summarization, and general text tasks. Supports 128K context window.",
      vramGb: 16,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "meta"],
      gated: true,
      downloads: 10000000,
      logo: "https://huggingface.co/meta-llama/resolve/main/Llama3.png",
      provider: "Meta",
    },
    {
      id: "mistralai/Mistral-7B-Instruct-v0.3",
      type: "model",
      name: "Mistral 7B Instruct v0.3",
      description: "Compact yet powerful 7B model from Mistral AI. Apache 2.0 licensed, great balance of speed and capability. Ideal for production deployments.",
      vramGb: 14,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "mistral"],
      gated: false,
      downloads: 8000000,
      logo: "https://huggingface.co/mistralai/resolve/main/mistral-logo.png",
      provider: "Mistral AI",
    },
    {
      id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      type: "model",
      name: "Mixtral 8x7B Instruct",
      description: "Sparse Mixture of Experts model with 8 experts. Only 13B parameters active per token, but 47B total. Excellent quality-to-compute ratio.",
      vramGb: 90,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "mistral", "moe"],
      gated: false,
      downloads: 4000000,
      logo: "https://huggingface.co/mistralai/resolve/main/mistral-logo.png",
      provider: "Mistral AI",
    },
    {
      id: "Qwen/Qwen2.5-7B-Instruct",
      type: "model",
      name: "Qwen 2.5 7B Instruct",
      description: "Alibaba's efficient 7B model with strong multilingual support. Excellent at Chinese and English, good at coding and math.",
      vramGb: 14,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "qwen"],
      gated: false,
      downloads: 5000000,
      logo: "https://huggingface.co/Qwen/resolve/main/assets/qwen2.5_logo.jpeg",
      provider: "Alibaba",
    },
    {
      id: "google/gemma-2-9b-it",
      type: "model",
      name: "Gemma 2 9B Instruct",
      description: "Google's efficient 9B model built on research from Gemini. Strong reasoning and instruction-following. Requires HF token.",
      vramGb: 18,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "google", "gemma"],
      gated: true,
      downloads: 6000000,
      logo: "https://huggingface.co/google/resolve/main/gemma_logo.png",
      provider: "Google",
    },
    {
      id: "google/gemma-2-27b-it",
      type: "model",
      name: "Gemma 2 27B Instruct",
      description: "Google's larger Gemma model with enhanced capabilities. Excellent at creative writing, analysis, and code. Requires HF token.",
      vramGb: 54,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "google", "gemma"],
      gated: true,
      downloads: 3000000,
      logo: "https://huggingface.co/google/resolve/main/gemma_logo.png",
      provider: "Google",
    },
    {
      id: "deepseek-ai/DeepSeek-Coder-V2-Instruct",
      type: "model",
      name: "DeepSeek Coder V2",
      description: "Specialized code generation model. Excels at Python, JavaScript, Java, C++, and 300+ programming languages. 128K context.",
      vramGb: 45,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["code", "deepseek", "programming"],
      gated: false,
      downloads: 1500000,
      logo: "https://huggingface.co/deepseek-ai/resolve/main/logo.png",
      provider: "DeepSeek",
    },
    {
      id: "microsoft/Phi-3.5-mini-instruct",
      type: "model",
      name: "Phi 3.5 Mini Instruct",
      description: "Microsoft's compact 3.8B model punching above its weight. Great for edge deployment, mobile, or when speed is critical.",
      vramGb: 8,
      deployScript: "tgi",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["llm", "chat", "microsoft", "small"],
      gated: false,
      downloads: 4000000,
      logo: "https://huggingface.co/microsoft/resolve/main/phi-logo.png",
      provider: "Microsoft",
    },
  ],

  // Docker images for development environments
  docker: [
    {
      id: "nvidia/pytorch:24.08-py3",
      type: "docker",
      name: "NVIDIA PyTorch 24.08",
      description: "Official NGC container with PyTorch 2.4, CUDA 12.4, cuDNN 9, and TensorRT. Optimized for A100/H100 with NCCL and NVTX profiling tools.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "nvcr.io/nvidia/pytorch:24.08-py3",
      tags: ["pytorch", "nvidia", "cuda", "development"],
      gated: false,
      logo: "https://www.nvidia.com/content/dam/en-zz/Solutions/about-nvidia/logo-and-brand/02-nvidia-logo-color-grn-500x200-4c25-p@2x.png",
      provider: "NVIDIA",
    },
    {
      id: "nvidia/tensorflow:24.08-tf2-py3",
      type: "docker",
      name: "NVIDIA TensorFlow 24.08",
      description: "Official NGC container with TensorFlow 2.17, CUDA 12.4, and Horovod for distributed training. Includes TensorRT for inference optimization.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "nvcr.io/nvidia/tensorflow:24.08-tf2-py3",
      tags: ["tensorflow", "nvidia", "cuda", "development"],
      gated: false,
      logo: "https://www.nvidia.com/content/dam/en-zz/Solutions/about-nvidia/logo-and-brand/02-nvidia-logo-color-grn-500x200-4c25-p@2x.png",
      provider: "NVIDIA",
    },
    {
      id: "pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel",
      type: "docker",
      name: "PyTorch 2.4 CUDA 12.4",
      description: "Official PyTorch container with CUDA 12.4 and cuDNN 9. Includes development headers for building custom CUDA extensions.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel",
      tags: ["pytorch", "cuda", "development"],
      gated: false,
      logo: "https://pytorch.org/assets/images/pytorch-logo.png",
      provider: "PyTorch",
    },
    {
      id: "huggingface/transformers-pytorch-gpu",
      type: "docker",
      name: "HuggingFace Transformers",
      description: "Complete HuggingFace stack with Transformers, Datasets, Tokenizers, and Accelerate. Ready for fine-tuning and inference.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "huggingface/transformers-pytorch-gpu:latest",
      tags: ["transformers", "huggingface", "pytorch"],
      gated: false,
      logo: "https://huggingface.co/front/assets/huggingface_logo-noborder.svg",
      provider: "Hugging Face",
    },
    {
      id: "ghcr.io/huggingface/text-generation-inference",
      type: "docker",
      name: "Text Generation Inference (TGI)",
      description: "Production-grade LLM inference server from HuggingFace. Features continuous batching, Flash Attention, and streaming support.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "ghcr.io/huggingface/text-generation-inference:latest",
      tags: ["inference", "llm", "huggingface", "production"],
      gated: false,
      logo: "https://huggingface.co/front/assets/huggingface_logo-noborder.svg",
      provider: "Hugging Face",
    },
    {
      id: "vllm/vllm-openai",
      type: "docker",
      name: "vLLM OpenAI Server",
      description: "High-throughput LLM serving engine with PagedAttention and OpenAI-compatible API. Up to 24x higher throughput than standard inference.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "vllm/vllm-openai:latest",
      tags: ["inference", "llm", "vllm", "openai"],
      gated: false,
      logo: "https://docs.vllm.ai/en/stable/_static/vllm-logo-text-light.png",
      provider: "vLLM",
    },
    {
      id: "ollama/ollama",
      type: "docker",
      name: "Ollama",
      description: "Run Llama, Mistral, Code Llama and other models locally. Simple CLI with automatic model management and quantization support.",
      vramGb: 0,
      deployScript: "ollama",
      dockerImage: "ollama/ollama:latest",
      tags: ["inference", "llm", "ollama", "easy"],
      gated: false,
      logo: "https://ollama.com/public/ollama.png",
      provider: "Ollama",
    },
    {
      id: "jupyter/pytorch-notebook",
      type: "docker",
      name: "Jupyter PyTorch Notebook",
      description: "JupyterLab environment with PyTorch, pandas, scikit-learn, and matplotlib. Includes GPU support and common ML libraries pre-installed.",
      vramGb: 0,
      deployScript: "docker",
      dockerImage: "jupyter/pytorch-notebook:latest",
      tags: ["jupyter", "pytorch", "notebook", "development"],
      gated: false,
      hasWebUI: true,
      webUIPort: 8888,
      logo: "https://jupyter.org/assets/logos/rectanglelogo-greytext-orangebody-greymoons.svg",
      provider: "Jupyter",
    },
  ],

  // Gradio Spaces templates
  spaces: [
    {
      id: "gradio/chatbot",
      type: "space",
      name: "Gradio Chat Template",
      description: "Beautiful chat interface template for LLMs. Includes streaming, conversation history, and customizable themes. Perfect starting point for AI chat apps.",
      vramGb: 0,
      deployScript: "space",
      tags: ["gradio", "chat", "template"],
      gated: false,
      hasWebUI: true,
      webUIPort: 7860,
      logo: "https://www.gradio.app/assets/img/logo.svg",
      provider: "Gradio",
    },
    {
      id: "stabilityai/stable-diffusion-3.5-large",
      type: "space",
      name: "Stable Diffusion 3.5 Large",
      description: "Stability AI's latest diffusion model. 8B parameters with superior prompt understanding, photorealism, and typography generation. Requires HF token.",
      vramGb: 24,
      deployScript: "space",
      tags: ["image", "diffusion", "stabilityai"],
      gated: true,
      hasWebUI: true,
      webUIPort: 7860,
      logo: "https://huggingface.co/stabilityai/resolve/main/stability-ai-logo.png",
      provider: "Stability AI",
    },
    {
      id: "black-forest-labs/FLUX.1-dev",
      type: "space",
      name: "FLUX.1 Dev",
      description: "State-of-the-art text-to-image model from Black Forest Labs. 12B parameter flow matching model with exceptional prompt adherence and image quality.",
      vramGb: 24,
      deployScript: "space",
      tags: ["image", "flux", "text-to-image"],
      gated: true,
      hasWebUI: true,
      webUIPort: 7860,
      logo: "https://huggingface.co/black-forest-labs/resolve/main/bfl-logo.png",
      provider: "Black Forest Labs",
    },
  ],
};

/**
 * Get all items across all categories
 */
export function getAllCatalogItems(): HFCatalogItem[] {
  const seen = new Set<string>();
  const result: HFCatalogItem[] = [];

  // Add items in order of priority, avoiding duplicates
  for (const item of [
    ...HF_CATALOG.popular,
    ...HF_CATALOG.rtxOptimized,
    ...HF_CATALOG.models,
    ...HF_CATALOG.docker,
    ...HF_CATALOG.spaces,
  ]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }

  return result;
}

/**
 * Get RTX-optimized models (≤24GB VRAM)
 */
export function getRtxOptimizedModels(): HFCatalogItem[] {
  return HF_CATALOG.rtxOptimized;
}

/**
 * Search catalog items by query
 */
export function searchCatalog(query: string): HFCatalogItem[] {
  const normalizedQuery = query.toLowerCase();
  return getAllCatalogItems().filter(
    (item) =>
      item.name.toLowerCase().includes(normalizedQuery) ||
      item.description.toLowerCase().includes(normalizedQuery) ||
      item.id.toLowerCase().includes(normalizedQuery) ||
      item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
  );
}

/**
 * Get items by type
 */
export function getCatalogByType(type: HFItemType): HFCatalogItem[] {
  switch (type) {
    case "model":
      return HF_CATALOG.models;
    case "docker":
      return HF_CATALOG.docker;
    case "space":
      return HF_CATALOG.spaces;
    default:
      return [];
  }
}

/**
 * Get a specific catalog item by ID
 */
export function getCatalogItem(id: string): HFCatalogItem | undefined {
  return getAllCatalogItems().find((item) => item.id === id);
}
