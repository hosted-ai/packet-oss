export function GET() {
  const content = `# GPU Cloud Platform

> On-demand GPU cloud infrastructure with NVIDIA GPUs. Deploy in minutes with SSH access, no contracts, and competitive pricing. Configure your own GPU offerings and pricing.

## Company

This platform is built on the open-source GPU cloud dashboard. Operators can customize this page with their own company information and branding.

## GPU Offerings

### Example: NVIDIA B200 (Blackwell) - $X.XX/hour
- 180GB HBM3e memory, 8 TB/s bandwidth
- FP16: 2,250 TFLOPS, FP8: 4,500 TFLOPS, FP4: 9,000 TFLOPS
- Best for: frontier model training, 100B+ parameter models, real-time inference

### Example: NVIDIA H200 (Hopper) - $X.XX/hour
- 141GB HBM3e memory, 4.8 TB/s bandwidth
- FP16: 1,979 TFLOPS, FP8: 3,958 TFLOPS
- Best for: LLM training, full-precision inference, multi-modal AI

### Example: NVIDIA RTX 6000 Pro (Blackwell) - $X.XX/hour
- 96GB GDDR7 ECC memory
- Best for: cost-effective inference, development, medium workloads

## Key Features

- Instant setup: signup to SSH in minutes
- Full root/sudo access with pre-installed CUDA
- On-demand billing (hourly or monthly), no contracts
- Uptime SLA with engineering support
- Persistent NVMe storage and saved pod storage
- HuggingFace one-click model deployment
- Web terminal, browser IDE, and Jupyter access

## Documentation

- Getting started: https://example.com/docs/getting-started
- API reference: https://example.com/docs/api-reference
- SSH access: https://example.com/docs/ssh
- HuggingFace deployment: https://example.com/docs/huggingface
- GPU metrics: https://example.com/docs/gpu-metrics
- Storage: https://example.com/docs/storage
- CLI: https://example.com/cli
- Budget controls: https://example.com/docs/budget-controls

## Links

- Website: https://example.com
- GPU pricing: https://example.com/#pricing
- Contact: https://example.com/contact
- Blog: https://example.com/blog
- About: https://example.com/about

## Contact

- Email: ${process.env.SUPPORT_EMAIL || "support@example.com"}
- Support: ${process.env.SUPPORT_EMAIL || "support@example.com"}
- Sales inquiries: https://example.com/contact
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
