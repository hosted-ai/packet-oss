/**
 * Progress Modal Component
 *
 * Shows deployment progress with logs and status.
 *
 * @module huggingface/ProgressModal
 */

"use client";

import Link from "next/link";
import type { DeploymentStatus } from "./types";

interface ProgressModalProps {
  modelName: string;
  status: DeploymentStatus;
  message: string;
  logs: string;
  apiEndpoint: string | null;
  notifyRequested: boolean;
  token: string;
  onClose: () => void;
  onRequestNotification: () => void;
}

export function ProgressModal({
  modelName,
  status,
  message,
  logs,
  apiEndpoint,
  notifyRequested,
  token,
  onClose,
  onRequestNotification,
}: ProgressModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Deployment Progress
              </h2>
              <p className="text-sm text-gray-600 mt-1">{modelName}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-6 h-6"
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
            </button>
          </div>

          {/* Status */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              {status === "running" ? (
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-green-600"
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
              ) : status === "failed" ? (
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-red-600"
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
              ) : (
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900">{message}</p>
                <p className="text-sm text-gray-500">
                  {status === "installing" && "Installing vLLM framework..."}
                  {status === "install_complete" && "Starting model server..."}
                  {status === "starting" && "Loading model weights..."}
                  {status === "running" && "Model is ready to use!"}
                  {status === "failed" && "Check logs for details"}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            {status !== "running" && status !== "failed" && (
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-500 animate-pulse"
                  style={{
                    width:
                      status === "installing"
                        ? "30%"
                        : status === "install_complete"
                        ? "60%"
                        : status === "starting"
                        ? "80%"
                        : "10%",
                  }}
                />
              </div>
            )}
          </div>

          {/* API Endpoint (when running) */}
          {status === "running" && apiEndpoint && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-medium text-green-800 mb-2">
                API Endpoint Ready
              </p>
              <code className="text-sm bg-white px-3 py-2 rounded border block overflow-x-auto">
                {apiEndpoint}
              </code>
            </div>
          )}

          {/* Logs */}
          {logs && (
            <div className="mb-6">
              <p className="text-sm font-medium text-gray-700 mb-2">Logs</p>
              <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-x-auto max-h-48 overflow-y-auto font-mono">
                {logs}
              </pre>
            </div>
          )}

          {/* Email notification option */}
          {status !== "running" && status !== "failed" && (
            <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Get notified when ready
                  </p>
                  <p className="text-xs text-gray-500">
                    We&apos;ll email you when your model is deployed
                  </p>
                </div>
                {notifyRequested ? (
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <svg
                      className="w-4 h-4"
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
                    Subscribed
                  </span>
                ) : (
                  <button
                    onClick={onRequestNotification}
                    className="px-4 py-2 text-sm bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors"
                  >
                    Notify Me
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {status === "running" ? "Close" : "Monitor in Background"}
            </button>
            {status === "running" && (
              <Link
                href={`/dashboard?token=${token}`}
                className="flex-1 py-2 px-4 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors text-center"
              >
                Go to Dashboard
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
