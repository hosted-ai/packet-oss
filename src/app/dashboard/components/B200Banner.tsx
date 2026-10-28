"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { slugMatches } from "./utils";

interface B200Product {
  id: string;
  name: string;
  billingType: string;
  pricePerHourCents: number | null;
  pricePerMonthCents: number | null;
  vramGb: number | null;
}

interface B200BannerProps {
  token: string;
  onDeploy: () => void;
}

// Fallback shown until/unless the live catalog has an active B200 product
// (matches the marketing-page figure in data/gpu-offerings.json).
const FALLBACK_HOURLY_CENTS = 375;
const FALLBACK_VRAM_GB = 180;

export function B200Banner({ token, onDeploy }: B200BannerProps) {
  const [products, setProducts] = useState<B200Product[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/instances/launch-options", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const category = (data.categories || []).find(
          (c: { slug?: string }) => slugMatches(c.slug, "b200")
        );
        if (!cancelled && category?.products) setProducts(category.products);
      } catch {
        /* non-fatal — banner still shows with generic copy */
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Interactive glow: the ambient background gradient drifts on its own via
  // CSS keyframes, but also leans toward the cursor while hovering.
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    cardRef.current?.style.setProperty("--cursor-x", `${x}%`);
    cardRef.current?.style.setProperty("--cursor-y", `${y}%`);
  };

  const hourly = products.find((p) => p.billingType === "hourly");
  const monthly = products.find((p) => p.billingType === "monthly");
  const vram = hourly?.vramGb || monthly?.vramGb || FALLBACK_VRAM_GB;
  const startingHourlyCents = hourly?.pricePerHourCents ?? FALLBACK_HOURLY_CENTS;

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      // TODO: swap onDeploy for the real deep link once it's provided —
      // whole banner is clickable so it mirrors the "Deploy B200" button.
      onClick={onDeploy}
      className="b200-banner mb-8 rounded-2xl relative isolate overflow-hidden bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800/80 cursor-pointer"
    >
      <div className="b200-glow b200-glow-ambient" />
      <div className="b200-glow b200-glow-cursor" />

      <div className="relative z-10 flex items-center justify-between gap-6 flex-wrap py-[5px] pl-3 pr-6">
        <div className="flex items-center gap-5 min-w-0">
          <div className="hidden sm:flex items-center justify-center shrink-0 w-[109px] h-[109px]">
            <Image
              src="/images/b200.png"
              alt="NVIDIA B200"
              width={220}
              height={216}
              className="w-full h-full object-contain translate-y-[12px]"
              priority
            />
          </div>

          <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              NVIDIA <span className="text-teal-400">B200</span>
            </h2>

            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-teal-300 bg-teal-500/10 border border-teal-500/30 rounded-full px-2.5 py-1">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full rounded-full bg-teal-400 opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-teal-400" />
              </span>
              Flagship GPU
            </span>
          </div>

          {/* Spec chips — quick-glance facts instead of one long line */}
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-xs text-zinc-300 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
              <svg className="w-3 h-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
                <path strokeLinecap="round" d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
              </svg>
              {vram}GB HBM3e
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-zinc-300 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
              <svg className="w-3 h-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v6m0 0l-3-3m3 3l3-3M6 10h12l1 10H5l1-10z" />
              </svg>
              Starts from <span className="text-white font-semibold">${(startingHourlyCents / 100).toFixed(2)}/hr</span>
            </span>
            {monthly?.pricePerMonthCents != null && (
              <span className="inline-flex items-center gap-1 text-xs text-zinc-300 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                ${(monthly.pricePerMonthCents / 100).toFixed(2)}/mo
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-zinc-300 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
              <svg className="w-3 h-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
              </svg>
              Live in &lt;5 min
            </span>
          </div>
          </div>
        </div>

        {/* Button sits beside the info block, not stacked below it, so the
            banner can stay short while keeping generous padding around the text. */}
        <button
          onClick={(e) => { e.stopPropagation(); onDeploy(); }}
          className="b200-deploy-btn relative overflow-hidden px-4 py-2.5 bg-gradient-to-br from-teal-400 to-teal-600 hover:brightness-110 text-white text-sm font-medium rounded-xl transition-[filter] flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <span className="relative z-10 flex items-center gap-1.5">
            Deploy B200
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
          <span className="b200-shine" />
        </button>
      </div>

      <style jsx>{`
        .b200-glow {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .b200-glow-ambient {
          background: radial-gradient(circle, rgba(45, 212, 191, 0.32), transparent 55%);
          background-size: 160% 160%;
          background-repeat: no-repeat;
          animation: b200-drift 14s ease-in-out infinite;
          filter: blur(4px);
        }
        .b200-glow-cursor {
          background: radial-gradient(
            circle at var(--cursor-x, 70%) var(--cursor-y, 40%),
            rgba(45, 212, 191, 0.18),
            transparent 40%
          );
          opacity: 0;
          transition: opacity 0.4s ease;
        }
        .b200-banner:hover .b200-glow-cursor {
          opacity: 1;
        }
        @keyframes b200-drift {
          0%, 100% { background-position: 75% 30%; }
          33% { background-position: 45% 65%; }
          66% { background-position: 85% 60%; }
        }
        .b200-shine {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            115deg,
            transparent 40%,
            rgba(255, 255, 255, 0.55) 50%,
            transparent 60%
          );
          background-size: 200% 100%;
          background-position: 150% 0;
          animation: b200-shine-sweep 3s ease-in-out infinite;
        }
        @keyframes b200-shine-sweep {
          0% { background-position: 150% 0; }
          50% { background-position: -50% 0; }
          100% { background-position: -50% 0; }
        }
      `}</style>
    </div>
  );
}
