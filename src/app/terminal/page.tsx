"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function TerminalContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Connecting...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscriptionId = searchParams.get("subscription_id");
    const token = searchParams.get("token");

    if (!subscriptionId || !token) {
      setError("Missing subscription_id or token");
      return;
    }

    async function connect() {
      try {
        setStatus("Fetching connection details...");

        // Get terminal connection info
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

        setStatus("Opening terminal...");

        // Create a form and submit it to webssh2 with credentials
        // This is more secure than putting password in URL
        const form = document.createElement("form");
        form.method = "POST";
        form.action = `/ssh/host/${encodeURIComponent(data.host)}`;
        form.target = "_self";

        // Add hidden fields
        const fields: Record<string, string> = {
          port: String(data.port || 22),
          username: data.username,
          userpassword: data.password || "",
          header: "GPU Terminal",
          headerBackground: "#059669",
        };

        for (const [key, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = value;
          form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
      } catch (err) {
        console.error("Terminal connection error:", err);
        setError(err instanceof Error ? err.message : "Failed to connect");
      }
    }

    connect();
  }, [searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-900 flex items-center justify-center">
        <div className="bg-zinc-800 rounded-lg p-6 max-w-md">
          <h1 className="text-red-400 text-lg font-semibold mb-2">Connection Error</h1>
          <p className="text-zinc-300">{error}</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-zinc-700 text-white rounded hover:bg-zinc-600"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
        <p className="text-zinc-300">{status}</p>
      </div>
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-900 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-zinc-300">Loading...</p>
          </div>
        </div>
      }
    >
      <TerminalContent />
    </Suspense>
  );
}
