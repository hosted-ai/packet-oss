import { Metadata } from "next";

export const metadata: Metadata = {
  title: "HuggingFace Integration - One-Click Model Deployment",
  description: "Deploy any HuggingFace model on GPU Cloud GPUs with one click. Automatic memory calculation, vLLM optimized serving, and OpenAI-compatible API endpoints.",
  alternates: {
    canonical: "https://the platform/huggingface",
  },
};

export default function HuggingFaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
