"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getBrandName } from "@/lib/branding-client";

// ---------------------------------------------------------------------------
// Tour step configuration
// ---------------------------------------------------------------------------

interface TourStep {
  /** Unique ID for this step */
  id: string;
  /** data-tour attribute value on the anchor element */
  target: string;
  /** Tooltip title */
  title: string;
  /** Tooltip body copy */
  body: string;
  /** Preferred tooltip position relative to anchor */
  position: "top" | "bottom" | "left" | "right";
}

/** All possible tour steps — steps whose anchor element isn't in the DOM
 *  (e.g. Bare Metal when not entitled) are filtered out at runtime. */
const ALL_TOUR_STEPS: TourStep[] = [
  {
    id: "ondemand",
    target: "ondemand-btn",
    title: "On-demand GPUs",
    body: "Spin up a GPU in about 3 minutes. Pay by the hour — perfect for experiments and short workloads.",
    position: "bottom",
  },
  {
    id: "monthly",
    target: "monthly-btn",
    title: "Monthly plans",
    body: "Commit monthly and save up to 40%. Ideal for longer training runs and always-on inference.",
    position: "bottom",
  },
  {
    id: "wallet",
    target: "wallet-card",
    title: "Top up your wallet to get started",
    body: "Click to add funds to your wallet. All GPU usage is billed from your prepaid balance.",
    position: "right",
  },
  {
    id: "baremetal",
    target: "baremetal-btn",
    title: "Bare metal servers",
    body: "Need dedicated hardware? Order bare metal GPUs with a term commitment — provisioned and billed via invoice.",
    position: "bottom",
  },
];

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

function tourCompletedKey(customerId: string) {
  return `packet_onboarding_tour_completed_${customerId}`;
}
function tourDismissedKey(customerId: string) {
  return `packet_onboarding_tour_dismissed_${customerId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OnboardingTourProps {
  /** True when the API signals this is the user's very first login */
  isNewSignup: boolean;
  /** Stripe customer ID — used to scope localStorage per user */
  customerId: string | undefined;
}

export function OnboardingTour({ isNewSignup, customerId }: OnboardingTourProps) {
  // ---- state ----
  const [showWelcome, setShowWelcome] = useState(false);
  const [showOutro, setShowOutro] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1); // -1 = not started
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; arrowDir: string; arrowOffset: number | null }>({
    top: 0,
    left: 0,
    arrowDir: "left",
    arrowOffset: null, // null = use 50%, number = pixel offset from top/left
  });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Filter to only steps whose anchor element exists in the DOM.
  // Recalculated when the tour starts (welcome → step 0).
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>([]);

  const computeVisibleSteps = useCallback(() => {
    return ALL_TOUR_STEPS.filter(
      (s) => document.querySelector(`[data-tour="${s.target}"]`) !== null
    );
  }, []);

  // ---- persistence helpers (scoped per customer) ----
  const isAlreadyDone = useCallback(() => {
    if (typeof window === "undefined" || !customerId) return true;
    return (
      localStorage.getItem(tourCompletedKey(customerId)) === "true" ||
      localStorage.getItem(tourDismissedKey(customerId)) === "true"
    );
  }, [customerId]);

  const markComplete = useCallback(() => {
    if (!customerId) return;
    localStorage.setItem(tourCompletedKey(customerId), "true");
  }, [customerId]);

  const markDismissed = useCallback(() => {
    if (!customerId) return;
    localStorage.setItem(tourDismissedKey(customerId), "true");
  }, [customerId]);

  // ---- auto-launch on first signup ----
  useEffect(() => {
    if (isNewSignup && !isAlreadyDone()) {
      // Small delay so the dashboard finishes painting
      const t = setTimeout(() => setShowWelcome(true), 800);
      return () => clearTimeout(t);
    }
  }, [isNewSignup, isAlreadyDone]);

  // ---- position the tooltip relative to its anchor ----
  const positionTooltip = useCallback(() => {
    if (currentStep < 0 || currentStep >= visibleSteps.length) return;
    const step = visibleSteps[currentStep];
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;

    // Scroll the target into view so it's not hidden off-screen
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const rect = el.getBoundingClientRect();
    setHighlightRect(rect);

    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;
    // arrowDir = direction the arrow POINTS (toward the target).
    // Opposite of the tooltip position: tooltip on the right → arrow points left.
    const oppositeDir = { right: "left", left: "right", bottom: "top", top: "bottom" } as const;
    let arrowDir: string = oppositeDir[step.position];

    switch (step.position) {
      case "right":
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.right + gap;
        if (left + tw > vw - 16) {
          left = rect.left - tw - gap;
          arrowDir = "right"; // flipped to left of target → arrow points right
        }
        break;
      case "left":
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.left - tw - gap;
        if (left < 16) {
          left = rect.right + gap;
          arrowDir = "left"; // flipped to right of target → arrow points left
        }
        break;
      case "bottom":
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tw / 2;
        if (top + th > vh - 16) {
          top = rect.top - th - gap;
          arrowDir = "bottom"; // flipped to above target → arrow points down
        }
        break;
      case "top":
        top = rect.top - th - gap;
        left = rect.left + rect.width / 2 - tw / 2;
        if (top < 16) {
          top = rect.bottom + gap;
          arrowDir = "top"; // flipped to below target → arrow points up
        }
        break;
    }

    // Clamp within viewport and compute arrow offset to track the target
    const unclampedTop = top;
    const unclampedLeft = left;
    if (left < 16) left = 16;
    if (left + tw > vw - 16) left = vw - tw - 16;
    if (top < 16) top = 16;
    if (top + th > vh - 16) top = vh - th - 16;

    // If clamping shifted the tooltip, adjust the arrow so it still
    // points at the target element's center instead of staying at 50%.
    let arrowOffset: number | null = null;
    const wasClamped = top !== unclampedTop || left !== unclampedLeft;
    if (wasClamped) {
      const targetCenterY = rect.top + rect.height / 2;
      const targetCenterX = rect.left + rect.width / 2;
      if (arrowDir === "left" || arrowDir === "right") {
        // Arrow is on the side — offset is vertical
        arrowOffset = Math.max(16, Math.min(th - 16, targetCenterY - top));
      } else {
        // Arrow is on top/bottom — offset is horizontal
        arrowOffset = Math.max(16, Math.min(tw - 16, targetCenterX - left));
      }
    }

    setTooltipPos({ top, left, arrowDir, arrowOffset });
  }, [currentStep, visibleSteps]);

  // Re-position on scroll / resize while a step is active
  useEffect(() => {
    if (currentStep < 0) return;

    const reposition = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(positionTooltip);
    };

    // Initial position
    reposition();

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [currentStep, positionTooltip]);

  // ---- navigation ----
  const startTour = () => {
    setVisibleSteps(computeVisibleSteps());
    setShowWelcome(false);
    setCurrentStep(0);
  };

  const nextStep = () => {
    if (currentStep < visibleSteps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      // Last tooltip step done → show outro
      setCurrentStep(-1);
      setHighlightRect(null);
      setShowOutro(true);
    }
  };

  const finishTour = () => {
    markComplete();
    setShowOutro(false);
  };

  const skipTour = () => {
    markDismissed();
    setShowWelcome(false);
    setShowOutro(false);
    setCurrentStep(-1);
  };

  // Allow re-launching from outside (nice-to-have)
  // Exposed via a global for now — a lightweight escape hatch.
  useEffect(() => {
    (window as Window & { __packetRestartTour?: () => void }).__packetRestartTour = () => {
      if (customerId) {
        localStorage.removeItem(tourCompletedKey(customerId));
        localStorage.removeItem(tourDismissedKey(customerId));
      }
      setShowOutro(false);
      setCurrentStep(-1);
      setShowWelcome(true);
    };
    return () => {
      delete (window as Window & { __packetRestartTour?: () => void }).__packetRestartTour;
    };
  }, [customerId]);

  // ---- render nothing when inactive ----
  if (!showWelcome && !showOutro && currentStep < 0) return null;

  const brandName = getBrandName();
  const isActive = currentStep >= 0 && currentStep < visibleSteps.length;
  const step = isActive ? visibleSteps[currentStep] : null;

  return (
    <>
      {/* =========== OVERLAY =========== */}
      <div
        className="fixed inset-0 z-[70] transition-opacity duration-300"
        style={{
          backgroundColor: "rgba(0,0,0,0.45)",
          // Punch a transparent hole around the highlighted element
          ...(isActive && highlightRect
            ? {
                maskImage: `
                  linear-gradient(#000 0 0),
                  linear-gradient(#000 0 0)
                `,
                WebkitMaskImage: `
                  linear-gradient(#000 0 0),
                  linear-gradient(#000 0 0)
                `,
                maskComposite: "exclude",
                WebkitMaskComposite: "destination-out",
                maskPosition: `0 0, ${highlightRect.left - 4}px ${highlightRect.top - 4}px`,
                WebkitMaskPosition: `0 0, ${highlightRect.left - 4}px ${highlightRect.top - 4}px`,
                maskSize: `100% 100%, ${highlightRect.width + 8}px ${highlightRect.height + 8}px`,
                WebkitMaskSize: `100% 100%, ${highlightRect.width + 8}px ${highlightRect.height + 8}px`,
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
              }
            : {}),
        }}
        onClick={skipTour}
        aria-hidden
      />

      {/* =========== HIGHLIGHT RING =========== */}
      {isActive && highlightRect && (
        <div
          className="fixed z-[71] rounded-xl pointer-events-none ring-2 ring-teal-400 ring-offset-2 transition-all duration-300"
          style={{
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
          }}
        />
      )}

      {/* =========== WELCOME SCREEN (Intro) =========== */}
      {showWelcome && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-in zoom-in-95 fade-in duration-200">
            {/* Icon */}
            <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-zinc-900 mb-2">Welcome to {brandName}</h2>
            <p className="text-sm text-zinc-500 mb-8 leading-relaxed">
              Let us show you around. A quick walkthrough of the key areas so you can top up and deploy your first GPU.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={startTour}
                className="w-full px-5 py-3 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-semibold rounded-xl transition-all text-sm cursor-pointer"
              >
                Let&apos;s go
              </button>
              <button
                onClick={skipTour}
                className="w-full px-5 py-2.5 text-zinc-500 hover:text-zinc-700 text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Skip tour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========== OUTRO SCREEN =========== */}
      {showOutro && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-in zoom-in-95 fade-in duration-200">
            {/* Checkmark icon */}
            <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-zinc-900 mb-2">You&apos;re all set!</h2>
            <p className="text-sm text-zinc-500 mb-8 leading-relaxed">
              That&apos;s the essentials. Top up your wallet, pick a GPU, and you&apos;ll be running in minutes. Enjoy the experience!
            </p>

            <button
              onClick={finishTour}
              className="w-full px-5 py-3 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white font-semibold rounded-xl transition-all text-sm cursor-pointer"
            >
              Start exploring
            </button>
          </div>
        </div>
      )}

      {/* =========== TOOLTIP =========== */}
      {isActive && step && (
        <div
          key={step.id}
          ref={tooltipRef}
          className="fixed z-[72] w-80 bg-white rounded-xl shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95 duration-200"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Arrow — tracks the target element when tooltip is viewport-clamped */}
          <div
            className="absolute w-3 h-3 bg-white border border-zinc-200 rotate-45"
            style={{
              ...(tooltipPos.arrowDir === "left" && {
                left: -7,
                top: tooltipPos.arrowOffset != null ? tooltipPos.arrowOffset - 6 : "50%",
                ...(tooltipPos.arrowOffset == null && { marginTop: -6 }),
                borderRight: "none",
                borderTop: "none",
              }),
              ...(tooltipPos.arrowDir === "right" && {
                right: -7,
                top: tooltipPos.arrowOffset != null ? tooltipPos.arrowOffset - 6 : "50%",
                ...(tooltipPos.arrowOffset == null && { marginTop: -6 }),
                borderLeft: "none",
                borderBottom: "none",
              }),
              ...(tooltipPos.arrowDir === "top" && {
                top: -7,
                left: tooltipPos.arrowOffset != null ? tooltipPos.arrowOffset - 6 : "50%",
                ...(tooltipPos.arrowOffset == null && { marginLeft: -6 }),
                borderBottom: "none",
                borderRight: "none",
              }),
              ...(tooltipPos.arrowDir === "bottom" && {
                bottom: -7,
                left: tooltipPos.arrowOffset != null ? tooltipPos.arrowOffset - 6 : "50%",
                ...(tooltipPos.arrowOffset == null && { marginLeft: -6 }),
                borderTop: "none",
                borderLeft: "none",
              }),
            }}
          />

          <div className="p-5">
            {/* Step indicator */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                Step {currentStep + 1} of {visibleSteps.length}
              </span>
              <button
                onClick={skipTour}
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Skip tour
              </button>
            </div>

            {/* Content */}
            <h3 className="text-sm font-semibold text-zinc-900 mb-1.5">{step.title}</h3>
            <p className="text-sm text-zinc-500 leading-relaxed mb-4">{step.body}</p>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              {/* Progress dots */}
              <div className="flex gap-1.5">
                {visibleSteps.map((_, i) => (
                  <div
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i === currentStep ? "bg-teal-500" : i < currentStep ? "bg-teal-300" : "bg-zinc-200"
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={nextStep}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {currentStep < visibleSteps.length - 1 ? (
                  <>
                    Next
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </>
                ) : (
                  "Got it!"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
