"use client";

import { useState } from "react";
import type { GpuOffering } from "@/app/admin/types";

interface GPUSelectorProps {
  offerings: GpuOffering[];
}

// CLI-style terminal lines per GPU — shows the packet CLI workflow
const TERMINAL_LINES: Record<
  string,
  { prompt?: string; cmd: string; dim?: boolean; accent?: boolean }[]
> = {
  b200: [
    { prompt: "$", cmd: "packet launch --gpu b200 --wait" },
    { cmd: "Launching B200 (180 GB HBM3e)...", dim: true },
    { cmd: "Instance i-83af ready in 47s", accent: true },
    { prompt: "$", cmd: "packet ssh i-83af" },
    { cmd: "root@b200 ~ #", dim: true },
    {
      prompt: "root@b200 ~ #",
      cmd: "torchrun --nproc_per_node=1 train.py --model llama-3.1-405B",
    },
    {
      cmd: "Epoch 1/10 ██████████████░░░░░░ 72 % | loss 0.847",
      dim: true,
    },
  ],
  h200: [
    { prompt: "$", cmd: "packet launch --gpu h200 --wait" },
    { cmd: "Launching H200 (141 GB HBM3e) in US-East...", dim: true },
    { cmd: "Instance i-29dc ready in 52s", accent: true },
    { prompt: "$", cmd: "packet ssh i-29dc" },
    { cmd: "root@h200 ~ #", dim: true },
    {
      prompt: "root@h200 ~ #",
      cmd: "vllm serve mistralai/Mistral-Large-Instruct-2407",
    },
    { cmd: "INFO:     Serving on http://0.0.0.0:8000", dim: true },
  ],
  rtx6000: [
    { prompt: "$", cmd: "packet launch --gpu rtx-pro-6000 --wait" },
    { cmd: "Launching RTX PRO 6000 (96 GB) in US-West...", dim: true },
    { cmd: "Instance i-61fb ready in 38s", accent: true },
    { prompt: "$", cmd: "packet ssh i-61fb" },
    { cmd: "root@rtx6000 ~ #", dim: true },
    {
      prompt: "root@rtx6000 ~ #",
      cmd: "vllm serve meta-llama/Llama-3.1-70B-Instruct",
    },
    { cmd: "INFO:     Serving on http://0.0.0.0:8000", dim: true },
  ],
};

export function GPUSelector({ offerings }: GPUSelectorProps) {
  const activeOfferings = offerings
    .filter((o) => o.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const [selectedId, setSelectedId] = useState(activeOfferings[0]?.id || "");

  const selected =
    activeOfferings.find((o) => o.id === selectedId) || activeOfferings[0];
  if (!selected) return null;

  const lines = TERMINAL_LINES[selected.id] || TERMINAL_LINES.rtx6000;

  // Deployable GPUs sorted by price (lowest first) — exclude sold out and coming soon
  const deployable = activeOfferings
    .filter((o) => !o.name.includes("H200") && !o.soldOut)
    .sort((a, b) => a.hourlyPrice - b.hourlyPrice);

  // Always lead with best-value deployable GPU
  const heroGpu = deployable[0];
  const secondaryGpu = deployable.find((o) => o.id !== heroGpu?.id);

  return (
    <section className="hero">
      <div className="container hero-split">
        {/* Left column — copy, CTA, GPU chips */}
        <div className="hero-left">
          <h1 className="display hero-headline">
            NVIDIA Blackwell GPUs.{" "}
            <span className="hero-headline-accent" style={{ whiteSpace: "nowrap" }}>Deployed in Minutes.</span>
          </h1>

          <p className="hero-sub">
            96 GB GDDR7 · Full Root SSH · No Contracts
          </p>

          <p className="hero-usp">
            Typically 50%+ below market · No contracts · Pay per second
          </p>

          <div className="hero-cta-group">
            <div className="hero-cta-row">
              <a href="/account" className="btn primary hero-btn">
                Start Building
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
              <a href="/#price-comparison" className="btn ghost hero-btn-secondary">
                Compare Prices
              </a>
            </div>
          </div>

          {/* GPU chips — pick a GPU, terminal updates */}
          <div className="gpu-chips" role="tablist">
            {activeOfferings.map((o) => {
              const active = o.id === selected.id;
              const soon = o.name.includes("H200");
              const soldOut = !!o.soldOut;
              return (
                <button
                  key={o.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedId(o.id)}
                  className={`gpu-chip${active ? " active" : ""}${soldOut ? " sold-out" : ""}`}
                >
                  <span className="gpu-chip-name">{o.name}</span>
                  <span className="gpu-chip-price">
                    {soldOut ? "Sold out" : soon ? "Coming soon" : `$${o.hourlyPrice.toFixed(2)}/hr`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right column — terminal demo */}
        <div className="hero-right">
          <div className="hero-terminal" role="tabpanel">
            <div className="terminal-titlebar">
              <div className="terminal-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <span className="terminal-title">packet-cli</span>
            </div>

            <div className="terminal-body">
              {lines.map((line, i) => (
                <div
                  key={`${selected.id}-${i}`}
                  className={`terminal-line${line.dim ? " dim" : ""}${line.accent ? " accent" : ""}`}
                >
                  {line.prompt && (
                    <span className="terminal-prompt">{line.prompt} </span>
                  )}
                  {line.cmd}
                </div>
              ))}
              <div className="terminal-line">
                <span className="terminal-prompt">$ </span>
                <span className="terminal-cursor" />
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
