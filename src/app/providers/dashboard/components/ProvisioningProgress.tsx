"use client";

import { useEffect, useState } from "react";
import type { ProviderNode, ProvisioningStep } from "../types";
import { getProvisioningSteps } from "../types";

interface ProvisioningProgressProps {
  node: ProviderNode;
}

// Total estimated provisioning time in minutes
const TOTAL_ESTIMATED_MINUTES = 20;

// Step weights for progress calculation (must sum to 100)
const STEP_WEIGHTS = {
  ssh_keys: 10,
  node_init: 60, // This is the longest step
  pool_creation: 20,
  ready: 10,
};

// Step descriptions with fun messages
const STEP_INFO: Record<
  string,
  {
    title: string;
    description: string;
    funMessages: string[];
  }
> = {
  ssh_keys: {
    title: "Installing SSH Keys",
    description: "Configuring secure access to your server",
    funMessages: [
      "Exchanging secret handshakes with your server...",
      "Teaching your server our secret knock...",
      "Setting up the VIP access pass...",
      "Your server is learning to trust us...",
    ],
  },
  node_init: {
    title: "Initializing Node",
    description: "Setting up Kubernetes and GPU drivers",
    funMessages: [
      "Waking up the GPUs from their slumber...",
      "Installing fancy GPU drivers...",
      "Teaching Kubernetes to speak GPU...",
      "Configuring the matrix (not that one)...",
      "Compiling the meaning of life (42)...",
      "Downloading more RAM... just kidding...",
      "Making sure the bits are in the right order...",
      "Consulting the GPU whisperer...",
      "Aligning the neural pathways...",
      "Warming up the tensor cores...",
      "This is the long part. Perfect time for coffee...",
      "Still working... your GPUs are almost ready to party...",
      "Kubernetes is doing Kubernetes things...",
      "Almost there... the GPUs are getting excited...",
    ],
  },
  pool_creation: {
    title: "Creating GPU Pool",
    description: "Detecting GPUs and configuring resource allocation",
    funMessages: [
      "Counting your GPUs (they're all beautiful)...",
      "Building the ultimate GPU party pool...",
      "Organizing the GPU neighborhood...",
      "Your GPUs are forming a team...",
    ],
  },
  ready: {
    title: "Ready for Customers",
    description: "Your server is now available on the marketplace",
    funMessages: [
      "Rolling out the red carpet...",
      "Putting up the 'Open for Business' sign...",
      "Your GPUs are ready to make you money!",
    ],
  },
};

// Fun loading messages that cycle
const GENERAL_FUN_MESSAGES = [
  "Good things come to those who wait...",
  "Your patience is appreciated...",
  "Building something awesome here...",
  "The robots are working hard...",
  "Quality takes time...",
  "Almost as fast as downloading a car...",
  "Making GPU magic happen...",
  "Converting coffee into infrastructure...",
  "Spinning up the hamster wheels...",
  "Please hold, your GPUs are important to us...",
];

export function ProvisioningProgress({ node }: ProvisioningProgressProps) {
  const [now, setNow] = useState(Date.now());
  const [funMessageIndex, setFunMessageIndex] = useState(0);
  const steps = getProvisioningSteps(node);

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cycle fun messages every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFunMessageIndex((prev) => prev + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Calculate elapsed time
  const createdAt = new Date(node.createdAt).getTime();
  const elapsedMs = now - createdAt;
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);

  // Calculate progress percentage based on completed steps
  let progressPercent = 0;
  let currentStepIndex = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const weight = STEP_WEIGHTS[step.id as keyof typeof STEP_WEIGHTS] || 0;

    if (step.status === "completed") {
      progressPercent += weight;
      currentStepIndex = i + 1;
    } else if (step.status === "in_progress") {
      // Add partial progress for in-progress step based on time
      const timeFactor = Math.min(0.8, elapsedMinutes / TOTAL_ESTIMATED_MINUTES);
      progressPercent += weight * timeFactor;
      currentStepIndex = i;
      break;
    } else {
      currentStepIndex = i;
      break;
    }
  }

  // If all steps completed, ensure 100%
  if (steps.every((s) => s.status === "completed")) {
    progressPercent = 100;
    currentStepIndex = steps.length;
  }

  // Estimate remaining time
  const estimatedRemainingMinutes = Math.max(
    0,
    TOTAL_ESTIMATED_MINUTES - elapsedMinutes
  );

  // Format time remaining
  const formatTimeRemaining = () => {
    if (estimatedRemainingMinutes <= 0) {
      return "Almost done...";
    }
    if (estimatedRemainingMinutes === 1) {
      return "~1 minute left";
    }
    return `~${estimatedRemainingMinutes} min left`;
  };

  const formatElapsed = () => {
    if (elapsedMinutes === 0) {
      return `${elapsedSeconds}s`;
    }
    return `${elapsedMinutes}m ${elapsedSeconds}s`;
  };

  // Get current step and fun message
  const currentStep = steps[Math.min(currentStepIndex, steps.length - 1)];
  const currentStepInfo = STEP_INFO[currentStep?.id] || {
    title: "Processing",
    description: "",
    funMessages: GENERAL_FUN_MESSAGES,
  };

  // Get a fun message for the current step
  const getCurrentFunMessage = () => {
    const messages = currentStepInfo.funMessages;
    if (!messages || messages.length === 0) return GENERAL_FUN_MESSAGES[0];
    return messages[funMessageIndex % messages.length];
  };

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-5">
      {/* Header with time info */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <div className="absolute inset-0 w-2 h-2 bg-blue-400 rounded-full animate-ping" />
          </div>
          <span className="text-sm font-semibold text-blue-900">
            Provisioning your server
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-blue-700 font-medium">{formatElapsed()}</span>
          <span className="text-blue-400">|</span>
          <span className="text-blue-600">{formatTimeRemaining()}</span>
        </div>
      </div>

      {/* Fun status message */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-blue-700 italic animate-pulse">
          {getCurrentFunMessage()}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="h-3 bg-blue-100 rounded-full overflow-hidden shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full transition-all duration-1000 ease-out relative"
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          >
            {/* Animated shine effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          </div>
        </div>
        <div className="flex justify-between mt-2 text-xs">
          <span className="text-blue-700 font-medium">
            {Math.round(progressPercent)}% complete
          </span>
          <span className="text-blue-500">~{TOTAL_ESTIMATED_MINUTES} min total</span>
        </div>
      </div>

      {/* Steps list - vertical timeline style */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3 top-3 bottom-3 w-0.5 bg-blue-200" />

        <div className="space-y-3">
          {steps.map((step, index) => {
            const stepInfo = STEP_INFO[step.id] || {
              title: step.label,
              description: "",
              funMessages: [],
            };
            const isActive = step.status === "in_progress";
            const isCompleted = step.status === "completed";
            const isError = step.status === "error";

            return (
              <div
                key={step.id}
                className={`flex items-start gap-3 pl-0 relative ${
                  isActive ? "" : ""
                }`}
              >
                {/* Step indicator */}
                <div className="flex-shrink-0 relative z-10">
                  {isCompleted ? (
                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-sm">
                      <svg
                        className="w-4 h-4 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  ) : isError ? (
                    <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-sm">
                      <svg
                        className="w-4 h-4 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </div>
                  ) : isActive ? (
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center shadow-sm relative">
                      <div className="w-2 h-2 bg-white rounded-full" />
                      <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-75" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs text-gray-500">
                      {index + 1}
                    </div>
                  )}
                </div>

                {/* Step content */}
                <div
                  className={`flex-1 pb-2 ${
                    isActive
                      ? "bg-white/50 -mx-2 px-2 py-2 rounded-lg border border-blue-100"
                      : ""
                  }`}
                >
                  <p
                    className={`text-sm font-medium ${
                      isCompleted
                        ? "text-green-700"
                        : isActive
                        ? "text-blue-900"
                        : isError
                        ? "text-red-700"
                        : "text-gray-400"
                    }`}
                  >
                    {stepInfo.title}
                    {isActive && (
                      <span className="ml-2 text-xs font-normal text-blue-600">
                        in progress
                      </span>
                    )}
                  </p>
                  {isActive && (
                    <p className="text-xs text-blue-600 mt-0.5">
                      {stepInfo.description}
                    </p>
                  )}
                  {isError && (
                    <p className="text-xs text-red-600 mt-0.5">
                      Something went wrong - retrying automatically...
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info footer */}
      <div className="mt-5 pt-4 border-t border-blue-200">
        <div className="flex items-start gap-2 text-xs text-blue-600">
          <svg
            className="w-4 h-4 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            Feel free to grab a coffee - we&apos;ll keep working in the
            background. Your server will be earning money soon!
          </span>
        </div>
      </div>
    </div>
  );
}
