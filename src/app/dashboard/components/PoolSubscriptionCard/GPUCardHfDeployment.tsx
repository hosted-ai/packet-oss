"use client";

import { useState } from "react";
import InferencePlayground from "@/components/InferencePlayground";
import GPUMetricsCard from "@/components/GPUMetricsCard";
import { HfDeploymentInfo } from "../types";

interface HfStatus {
  status: string;
  message: string;
  logs?: string;
  error?: string;
}

interface ExposedService {
  id: number;
  internal_port?: number;
  port?: number;
}

interface GPUCardHfDeploymentProps {
  hfDeployment: HfDeploymentInfo;
  hfStatus: HfStatus | null;
  subscriptionId: string;
  token: string;
  podName?: string;
  exposedServices: ExposedService[];
  onExposeVllmApi: () => Promise<void>;
  exposingVllmApi: boolean;
  sshHost?: string;
}

export function GPUCardHfDeployment({
  hfDeployment,
  hfStatus,
  subscriptionId,
  token,
  exposedServices,
  onExposeVllmApi,
  exposingVllmApi,
  sshHost,
}: GPUCardHfDeploymentProps) {
  const [hfLogsExpanded, setHfLogsExpanded] = useState(false);
  const [showFullLogsModal, setShowFullLogsModal] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);

  const isDeploymentActive = ["pending", "deploying", "installing", "starting"].includes(hfDeployment.status);

  return (
    <div className="border-t border-[var(--line)]">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span className="text-sm font-medium text-[var(--ink)]">
              {hfDeployment.hfItemName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(hfStatus?.status === "installing" || hfStatus?.status === "starting") && (
              <span className="animate-spin text-amber-500">⟳</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              hfStatus?.status === "running" ? "bg-emerald-100 text-emerald-700" :
              hfStatus?.status === "failed" ? "bg-rose-100 text-rose-700" :
              hfStatus?.status === "installing" || hfStatus?.status === "starting" ? "bg-amber-100 text-amber-700" :
              "bg-zinc-100 text-zinc-600"
            }`}>
              {hfStatus?.status || hfDeployment.status}
            </span>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)] mb-2">
          {hfStatus?.message || `Deployment started ${new Date(hfDeployment.createdAt).toLocaleString()}`}
        </p>
        {hfDeployment.errorMessage && (
          <p className="text-xs text-rose-600 mb-2">{hfDeployment.errorMessage}</p>
        )}

        {/* Action buttons when model is running */}
        {hfStatus?.status === "running" && (
          <div className="flex flex-wrap gap-2 mt-2">
            {/* Test Chat button */}
            <button
              onClick={() => setShowPlayground(true)}
              className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Test Chat
            </button>

            {/* Expose API button when port 8000 not exposed */}
            {!exposedServices.some((s) => (s.internal_port || s.port) === 8000) && (
              <button
                onClick={onExposeVllmApi}
                disabled={exposingVllmApi}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {exposingVllmApi ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    Exposing API...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Expose API Endpoint
                  </>
                )}
              </button>
            )}

            {/* Netdata GPU Monitoring button */}
            {hfDeployment.netdata && sshHost && (
              <a
                href={`http://${sshHost}:${hfDeployment.netdataPort || 19999}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                GPU Metrics
              </a>
            )}

            {/* Open WebUI Chat button */}
            {hfDeployment.openWebUI && sshHost && (
              <a
                href={`http://${sshHost}:${hfDeployment.webUiPort || 3000}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Chat UI
              </a>
            )}
          </div>
        )}

        {/* GPU Metrics - show when model is running */}
        {hfStatus?.status === "running" && (
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <GPUMetricsCard
              subscriptionId={subscriptionId}
              token={token}
              isVisible={true}
            />
          </div>
        )}

        {hfStatus?.logs && (
          <div className="mt-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setHfLogsExpanded(!hfLogsExpanded)}
                className="text-xs text-[var(--blue)] hover:underline flex items-center gap-1"
              >
                <svg className={`w-3 h-3 transition-transform ${hfLogsExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {hfLogsExpanded ? "Hide logs" : "Show logs"}
              </button>
              <button
                onClick={() => setShowFullLogsModal(true)}
                className="text-xs text-[var(--blue)] hover:underline flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                View Full Logs
              </button>
            </div>
            {hfLogsExpanded && (
              <pre className="mt-2 p-3 bg-zinc-900 text-zinc-100 text-xs rounded-lg overflow-x-auto max-h-48 overflow-y-auto font-mono">
                {hfStatus.logs}
              </pre>
            )}
          </div>
        )}

        {/* Full Logs Modal */}
        {showFullLogsModal && hfStatus?.logs && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowFullLogsModal(false)}>
            <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-800 border-b border-zinc-700">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <button onClick={() => setShowFullLogsModal(false)} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                  </div>
                  <span className="text-zinc-300 text-sm font-medium">Deployment Logs - {hfDeployment?.hfItemName}</span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(hfStatus.logs || "");
                  }}
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-zinc-100 text-xs font-mono whitespace-pre-wrap break-words">
                  {hfStatus.logs}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Inference Playground Modal */}
        {showPlayground && (
          <InferencePlayground
            subscriptionId={subscriptionId}
            modelName={hfDeployment.hfItemName}
            token={token}
            onClose={() => setShowPlayground(false)}
          />
        )}
      </div>
    </div>
  );
}
