"use client";

import { useState, useEffect } from "react";
import { getBrandName } from "@/lib/branding";

interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  action?: () => void;
  actionLabel?: string;
}

interface OnboardingChecklistProps {
  walletBalance: number;
  hasGpuRunning: boolean;
  hasPoolSubscriptions: boolean;
  onNavigateToTab: (tab: string) => void;
  onAddFunds: () => void;
  onExploreGPUs: () => void;
}

const DISMISSED_KEY = "packet_onboarding_dismissed";

export function OnboardingChecklist({
  walletBalance,
  hasGpuRunning,
  hasPoolSubscriptions,
  onNavigateToTab,
  onAddFunds,
  onExploreGPUs,
}: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(true); // Default true to prevent flash
  const [exploredInventory, setExploredInventory] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "true");
    setExploredInventory(localStorage.getItem("packet_explored_inventory") === "true");
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  const markExplored = () => {
    localStorage.setItem("packet_explored_inventory", "true");
    setExploredInventory(true);
  };

  const steps: OnboardingStep[] = [
    {
      id: "account",
      label: "Create account",
      description: "You're in!",
      completed: true,
    },
    {
      id: "explore",
      label: "Explore GPU inventory",
      description: "See what's available",
      completed: exploredInventory || hasPoolSubscriptions || hasGpuRunning,
      action: () => {
        markExplored();
        onExploreGPUs();
      },
      actionLabel: "View GPUs",
    },
    {
      id: "funds",
      label: "Add funds to your wallet",
      description: walletBalance > 0 ? `$${(walletBalance / 100).toFixed(2)} balance` : "Top up to deploy",
      completed: walletBalance > 0,
      action: onAddFunds,
      actionLabel: "Add Funds",
    },
    {
      id: "gpu",
      label: "Launch your first GPU",
      description: "SSH in and start building",
      completed: hasPoolSubscriptions || hasGpuRunning,
      action: () => onNavigateToTab("dashboard"),
      actionLabel: "Launch GPU",
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const allComplete = completedCount === steps.length;

  // Don't show if dismissed or all steps complete
  if (dismissed || allComplete) return null;

  // Find the next incomplete step
  const nextStep = steps.find((s) => !s.completed);

  return (
    <div className="mb-8 rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white to-zinc-50 p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-[var(--ink)] text-sm">Get started with {getBrandName()}</h3>
            <p className="text-xs text-[var(--muted)]">{completedCount} of {steps.length} complete</p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-[var(--muted)] hover:text-[var(--ink)] text-xs transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-zinc-100 rounded-full mb-5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-teal-500 to-teal-400 rounded-full transition-all duration-500"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <div className="grid grid-cols-4 gap-3">
        {steps.map((step, i) => {
          const isNext = nextStep?.id === step.id;
          return (
            <button
              key={step.id}
              onClick={!step.completed && step.action ? step.action : undefined}
              className={`relative text-left rounded-xl p-3.5 transition-all ${
                step.completed
                  ? "bg-teal-50/60 border border-teal-100"
                  : isNext
                    ? "bg-white border-2 border-teal-500 shadow-sm shadow-teal-500/10"
                    : "bg-white border border-zinc-100"
              } ${!step.completed && step.action ? "cursor-pointer hover:border-teal-300 hover:shadow-sm" : "cursor-default"}`}
            >
              {/* Step number / check */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mb-2.5 ${
                step.completed
                  ? "bg-teal-500 text-white"
                  : isNext
                    ? "bg-teal-500 text-white"
                    : "bg-zinc-100 text-zinc-400"
              }`}>
                {step.completed ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>

              <div className={`text-xs font-medium mb-0.5 ${
                step.completed ? "text-teal-700" : "text-[var(--ink)]"
              }`}>
                {step.label}
              </div>
              <div className={`text-[11px] ${
                step.completed ? "text-teal-600/60" : "text-[var(--muted)]"
              }`}>
                {step.description}
              </div>

              {/* CTA for next step */}
              {isNext && step.action && (
                <div className="mt-2.5 text-[11px] font-semibold text-teal-600 flex items-center gap-1">
                  {step.actionLabel}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
