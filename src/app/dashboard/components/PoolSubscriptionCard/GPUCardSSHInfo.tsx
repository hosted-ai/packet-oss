"use client";

import { useState } from "react";
import { ConnectionInfo, PoolSubscription } from "../types";

interface PodInfo {
  pod_name: string;
  pod_status: string;
  gpu_count?: number;
  ssh_info?: {
    cmd: string;
    pass: string;
  };
  internal_ip?: string;
  discovered_services?: Array<{
    name: string;
    url?: string;
  }>;
}

interface GPUCardSSHInfoProps {
  pods: PodInfo[];
  subscriptionPods?: PoolSubscription["pods"];
  loadingConnection: boolean;
  onOpenTerminal: () => void;
}

export function GPUCardSSHInfo({
  pods,
  subscriptionPods,
  loadingConnection,
  onOpenTerminal,
}: GPUCardSSHInfoProps) {
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});

  return (
    <div className="p-4 space-y-3">
      {pods.map((pod, idx) => {
        const sshInfo = pod.ssh_info;
        const internalIP = pod.internal_ip;
        const podStatus = pod.pod_status || (subscriptionPods?.[idx]?.pod_status || 'Unknown');

        return (
          <div key={idx} className="space-y-3">
            {/* SSH Connection Info */}
            {sshInfo && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-10 shrink-0">SSH</span>
                  <code className="flex-1 text-xs bg-zinc-900 px-3 py-2 rounded-lg font-mono text-green-400 truncate select-all" title={sshInfo.cmd}>
                    {sshInfo.cmd}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(sshInfo.cmd)}
                    className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-10 shrink-0">Pass</span>
                  <code className="flex-1 text-xs bg-zinc-900 px-3 py-2 rounded-lg font-mono text-green-400 select-all">
                    {showPassword[pod.pod_name] ? sshInfo.pass : "••••••••••••"}
                  </code>
                  <button
                    onClick={() => setShowPassword(prev => ({ ...prev, [pod.pod_name]: !prev[pod.pod_name] }))}
                    className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {showPassword[pod.pod_name] ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      ) : (
                        <>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </>
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(sshInfo.pass)}
                    className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                {internalIP && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 w-10 shrink-0">Int IP</span>
                    <code className="flex-1 text-xs bg-zinc-900 px-3 py-2 rounded-lg font-mono text-green-400 select-all">
                      {internalIP}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(internalIP)}
                      className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {loadingConnection && !sshInfo && podStatus === "Running" && (
              <div className="text-xs text-zinc-400 flex items-center gap-1 py-2">
                <span className="animate-spin">⟳</span> Loading connection info...
              </div>
            )}

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              {/* Only show terminal when pod is actually running - not during ContainerCreating/ContainerStatusUnknown */}
              {sshInfo && podStatus === "Running" && (
                <button
                  onClick={onOpenTerminal}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Terminal
                </button>
              )}
              {subscriptionPods?.[idx]?.discovered_services?.map((svc, svcIdx) => {
                const isJupyter = svc.name.toLowerCase().includes('jupyter');
                return (
                  <a
                    key={svcIdx}
                    href={svc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                      isJupyter
                        ? 'bg-orange-500 hover:bg-orange-600 text-white'
                        : 'bg-zinc-700 hover:bg-zinc-800 text-white'
                    }`}
                  >
                    {isJupyter && (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                      </svg>
                    )}
                    {isJupyter ? 'Jupyter' : svc.name}
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
