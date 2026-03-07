"use client";

import { useState, useRef, useEffect } from "react";

interface HelpTooltipProps {
  /** The help content to display */
  content: React.ReactNode;
  /** Optional title for the tooltip */
  title?: string;
  /** Position of the tooltip */
  position?: "top" | "bottom" | "left" | "right";
  /** Custom trigger element (defaults to info icon) */
  children?: React.ReactNode;
  /** Additional class names */
  className?: string;
  /** Icon size */
  iconSize?: "sm" | "md";
}

export function HelpTooltip({
  content,
  title,
  position = "top",
  children,
  className = "",
  iconSize = "sm",
}: HelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Calculate position when opening
  useEffect(() => {
    if (!isOpen || !triggerRef.current || !tooltipRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let top = 0;
    let left = 0;

    switch (position) {
      case "top":
        top = trigger.top - tooltip.height - 8;
        left = trigger.left + trigger.width / 2 - tooltip.width / 2;
        break;
      case "bottom":
        top = trigger.bottom + 8;
        left = trigger.left + trigger.width / 2 - tooltip.width / 2;
        break;
      case "left":
        top = trigger.top + trigger.height / 2 - tooltip.height / 2;
        left = trigger.left - tooltip.width - 8;
        break;
      case "right":
        top = trigger.top + trigger.height / 2 - tooltip.height / 2;
        left = trigger.right + 8;
        break;
    }

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + tooltip.width > viewport.width - 8) {
      left = viewport.width - tooltip.width - 8;
    }
    if (top < 8) top = 8;
    if (top + tooltip.height > viewport.height - 8) {
      top = viewport.height - tooltip.height - 8;
    }

    setTooltipPosition({ top, left });
  }, [isOpen, position]);

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const iconSizeClass = iconSize === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className={`inline-flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 rounded-full ${className}`}
        aria-label="Help"
        aria-expanded={isOpen}
      >
        {children || (
          <svg
            className={iconSizeClass}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          ref={tooltipRef}
          className="fixed z-50 max-w-xs bg-zinc-900 text-white text-sm rounded-lg shadow-xl p-3 animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: tooltipPosition.top,
            left: tooltipPosition.left,
          }}
          role="tooltip"
        >
          {title && (
            <div className="font-medium text-white mb-1.5 flex items-center gap-1.5">
              <span className="text-amber-400">💡</span>
              {title}
            </div>
          )}
          <div className="text-zinc-300 leading-relaxed">{content}</div>
        </div>
      )}
    </>
  );
}

// Pre-defined help content for common terms
export const HELP_CONTENT = {
  // GPU Metrics
  gpuUtilization: {
    title: "GPU Utilization",
    content: (
      <>
        Measures how busy the GPU cores are. 70-90% is optimal for training workloads.
        <br /><br />
        <span className="text-zinc-400">Low utilization?</span> Your code may be bottlenecked by CPU, I/O, or data loading.
      </>
    ),
  },
  vram: {
    title: "VRAM (Video RAM)",
    content: (
      <>
        GPU memory used by your models and data. Running out of VRAM causes out-of-memory (OOM) errors.
        <br /><br />
        <span className="text-zinc-400">Tip:</span> Use gradient checkpointing or mixed precision to reduce memory usage.
      </>
    ),
  },
  tflops: {
    title: "TFLOPs",
    content: (
      <>
        Tera Floating-point Operations Per Second. Measures actual compute throughput.
        <br /><br />
        Higher is better - indicates your GPU is doing useful work, not just waiting.
      </>
    ),
  },
  smActivity: {
    title: "SM Activity",
    content: (
      <>
        Streaming Multiprocessor activity - the actual compute cores doing work.
        <br /><br />
        <span className="text-zinc-400">High GPU Util + Low SM Activity?</span> Your workload is memory or communication bound, not compute bound.
      </>
    ),
  },
  temperature: {
    title: "GPU Temperature",
    content: (
      <>
        Current GPU core temperature. GPUs throttle performance above 80°C.
        <br /><br />
        <span className="text-teal-400">Normal:</span> 40-75°C
        <br />
        <span className="text-amber-400">Warm:</span> 75-85°C
        <br />
        <span className="text-rose-400">Hot:</span> 85°C+
      </>
    ),
  },

  // Billing Terms
  hourlyRate: {
    title: "Hourly Rate",
    content: (
      <>
        Cost per hour while your GPU is running. Billing is calculated per-second for accuracy.
        <br /><br />
        <span className="text-zinc-400">Stopped instances</span> are charged at a reduced rate (typically 25%) to reserve your GPU.
      </>
    ),
  },
  walletBalance: {
    title: "Wallet Balance",
    content: (
      <>
        Your prepaid credit balance. GPU costs are deducted automatically as you use them.
        <br /><br />
        <span className="text-zinc-400">Auto-refill:</span> When balance drops below $10, we'll automatically charge your card.
      </>
    ),
  },
  stoppedRate: {
    title: "Stopped Instance Rate",
    content: (
      <>
        When you stop (pause) a GPU, you still pay a reduced rate to keep it reserved for you.
        <br /><br />
        This ensures your data and configuration are preserved and the GPU is immediately available when you restart.
        <br /><br />
        <span className="text-zinc-400">To stop all charges:</span> Terminate the instance.
      </>
    ),
  },

  // Instance States
  provisioning: {
    title: "Provisioning",
    content: (
      <>
        Your GPU is being set up. This typically takes 30-90 seconds.
        <br /><br />
        We&apos;re allocating hardware, pulling your container image, and configuring networking.
      </>
    ),
  },
  settingUp: {
    title: "Setting Up",
    content: (
      <>
        Your startup script is running. Check the terminal for progress.
        <br /><br />
        This runs commands you specified (like installing packages or downloading models).
      </>
    ),
  },

  // Features
  persistentStorage: {
    title: "Persistent Storage",
    content: (
      <>
        Data stored here survives instance restarts and termination.
        <br /><br />
        <span className="text-zinc-400">Mount point:</span> <code className="bg-zinc-800 px-1 rounded">/workspace</code>
        <br /><br />
        Save models, datasets, and checkpoints here to avoid re-downloading.
      </>
    ),
  },
  snapshot: {
    title: "Snapshot",
    content: (
      <>
        Saves your GPU&apos;s current state so you can restore it later.
        <br /><br />
        Includes installed packages, file changes, and configuration. Great for pausing work overnight.
      </>
    ),
  },
  serviceExposure: {
    title: "Service Exposure",
    content: (
      <>
        Makes internal ports accessible via a public URL.
        <br /><br />
        Use this to access Jupyter, TensorBoard, or custom APIs running on your GPU.
      </>
    ),
  },
} as const;

export type HelpContentKey = keyof typeof HELP_CONTENT;
