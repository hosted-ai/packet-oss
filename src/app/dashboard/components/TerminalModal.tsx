"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const XTerminal = dynamic(() => import("@/components/XTerminal"), { ssr: false });

interface TerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptionId: string;
  token: string;
}

export function TerminalModal({ isOpen, onClose, subscriptionId, token }: TerminalModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ host: string; port: number; username: string; password: string; wsToken?: string } | null>(null);
  const [showCredentials, setShowCredentials] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setLoading(true);
      setError(null);
      setCredentials(null);
      setShowCredentials(true);
      return;
    }

    async function fetchCredentials() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/terminal?subscription_id=${subscriptionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Failed to get terminal info");
        }
        const data = await response.json();
        if (!data.host || !data.username) {
          throw new Error("Invalid connection info received");
        }
        setCredentials({
          host: data.host,
          port: data.port || 22,
          username: data.username,
          password: data.password || "",
          wsToken: data.wsToken,
        });
        setLoading(false);
      } catch (err) {
        console.error("Terminal connection error:", err);
        setError(err instanceof Error ? err.message : "Failed to connect");
        setLoading(false);
      }
    }
    fetchCredentials();
  }, [isOpen, subscriptionId, token]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-800 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-zinc-300 text-sm font-medium">Terminal</span>
          </div>
          <div className="flex items-center gap-2">
            {credentials && (
              <button
                onClick={() => setShowCredentials(!showCredentials)}
                className="text-xs text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-zinc-700"
              >
                {showCredentials ? "Hide" : "Show"} Credentials
              </button>
            )}
            <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {credentials && showCredentials && (
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-zinc-700 flex items-center gap-4 text-xs">
            <span className="text-zinc-400">Host:</span>
            <code className="text-emerald-400 font-mono">{credentials.host}:{credentials.port}</code>
            <span className="text-zinc-400">User:</span>
            <code className="text-emerald-400 font-mono">{credentials.username}</code>
            <span className="text-zinc-400">Pass:</span>
            <code className="text-emerald-400 font-mono">{credentials.password}</code>
            <button
              onClick={() => navigator.clipboard.writeText(credentials.password)}
              className="text-zinc-400 hover:text-white transition-colors ml-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto mb-3"></div>
                <p className="text-zinc-400 text-sm">Loading terminal...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10">
              <div className="text-center max-w-md px-4">
                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-red-400 font-medium mb-1">Connection Failed</p>
                <p className="text-zinc-400 text-sm mb-4">{error}</p>
                <button onClick={onClose} className="px-4 py-2 bg-zinc-700 text-white rounded-lg hover:bg-zinc-600 transition-colors text-sm">
                  Close
                </button>
              </div>
            </div>
          )}
          {credentials && !loading && !error && (
            <div className="w-full h-full">
              <XTerminal host={credentials.host} port={credentials.port} username={credentials.username} password={credentials.password} wsToken={credentials.wsToken} onClose={onClose} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
