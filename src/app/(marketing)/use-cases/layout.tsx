import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Use Cases - AI Training, Inference & Research",
  description: "How teams use GPU Cloud for LLM training, AI inference, fine-tuning, computer vision, scientific computing, and 3D rendering. Real workload examples on B200, H200, and RTX 6000 96GB GPUs.",
  alternates: {
    canonical: "https://example.com/use-cases",
  },
};

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
