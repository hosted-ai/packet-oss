"use client";

import { useState, useEffect } from "react";

interface RunScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptionId: string;
  token: string;
  podName?: string;
}

export function RunScriptModal({ isOpen, onClose, subscriptionId, token, podName }: RunScriptModalProps) {
  const [script, setScript] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; output: string; exitCode: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setScript("");
      setResult(null);
      setError(null);
      setRunning(false);
    }
  }, [isOpen]);

  const handleRunScript = async () => {
    if (!script.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/instances/run-script", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          script: script.trim(),
          subscriptionId,
          podName,
          timeout: 120,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to run script");
      setResult({ success: data.success, output: data.output, exitCode: data.exitCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run script");
    } finally {
      setRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-[var(--ink)]">Run Script</h2>
            <p className="text-xs text-[var(--muted)]">Execute a bash script on the pod</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-2">Script</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="#!/bin/bash&#10;echo 'Hello from GPU!'&#10;nvidia-smi"
              className="w-full h-40 px-4 py-3 border border-[var(--line)] rounded-xl text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              disabled={running}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {result && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  result.success ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}>
                  Exit code: {result.exitCode}
                </span>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4 max-h-64 overflow-y-auto">
                <pre className="text-sm text-zinc-100 font-mono whitespace-pre-wrap break-words">
                  {result.output || "(no output)"}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--line)] px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-[var(--ink)] transition-colors">
            Close
          </button>
          <button
            onClick={handleRunScript}
            disabled={running || !script.trim()}
            className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {running ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running...
              </>
            ) : (
              "Run Script"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
