"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  host: string;
  port: number;
  username: string;
  password: string;
  wsToken?: string; // Signed token for secure WebSocket auth
  onClose?: () => void;
}

type MessageData =
  | { type: "connected" }
  | { type: "data"; data: string }
  | { type: "error"; message: string };

export default function XTerminal({
  host,
  port,
  username,
  password,
  wsToken,
}: XTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, monospace',
      fontSize: 14,
      scrollback: 5000,
      theme: {
        background: "#18181b",
        foreground: "#e4e4e7",
        cursor: "#10b981",
        cursorAccent: "#18181b",
        selectionBackground: "#27272a",
        black: "#18181b",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
    });

    terminalInstance.current = term;

    // Add addons
    fitAddon.current = new FitAddon();
    term.loadAddon(fitAddon.current);
    term.loadAddon(new WebLinksAddon());

    // Open terminal
    term.open(terminalRef.current);
    fitAddon.current.fit();

    term.writeln("Connecting to SSH server...");
    term.writeln(`Host: ${host}:${port}`);
    term.writeln(`User: ${username}`);
    term.writeln("");

    // Build WebSocket URL with signed token (credentials never in URL)
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (!wsToken) {
      console.error("WebSocket token required for terminal connection");
      setErrorMessage("Terminal connection requires authentication token");
      return;
    }
    const wsUrl = `${wsProtocol}//${window.location.host}/ssh-ws?token=${encodeURIComponent(wsToken)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg: MessageData = JSON.parse(event.data);

        if (msg.type === "connected") {
          setStatus("connected");
          term.clear();
          // Send terminal size immediately after connection
          if (fitAddon.current) {
            fitAddon.current.fit();
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: term.cols,
                rows: term.rows,
              })
            );
          }
        } else if (msg.type === "data") {
          const data = atob(msg.data);
          term.write(data);
        } else if (msg.type === "error") {
          setStatus("error");
          setErrorMessage(msg.message);
          term.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
        }
      } catch (err) {
        console.error("Failed to parse message:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setStatus("error");
      setErrorMessage("WebSocket connection failed");
      term.writeln("\r\n\x1b[31mWebSocket connection failed\x1b[0m");
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      term.writeln("\r\n\x1b[33mConnection closed\x1b[0m");
    };

    // Handle terminal input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: btoa(data) }));
      }
    });

    // Handle resize
    const handleResize = () => {
      if (fitAddon.current && terminalRef.current) {
        try {
          fitAddon.current.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: term.cols,
                rows: term.rows,
              })
            );
          }
        } catch (e) {
          console.error("Fit error:", e);
        }
      }
    };

    window.addEventListener("resize", handleResize);

    // Use ResizeObserver for more reliable container resize detection
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Initial resize with multiple delays to catch container layout
    setTimeout(handleResize, 50);
    setTimeout(handleResize, 150);
    setTimeout(handleResize, 300);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [host, port, username, password]);

  return (
    <div className="h-full w-full bg-zinc-900 relative">
      {/* Terminal container - absolute positioning ensures proper size calculation */}
      <div
        ref={terminalRef}
        className="absolute inset-0 p-1"
        style={{ paddingBottom: status === "error" && errorMessage ? "40px" : "4px" }}
      />

      {/* Error message */}
      {status === "error" && errorMessage && (
        <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-red-900/50 border-t border-red-700 text-red-300 text-sm">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
