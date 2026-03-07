import { readFileSync } from "fs";
import path from "path";

// Load .env.local manually since this runs outside of Next.js
// (dotenv is not a direct dependency in pnpm, so we parse it ourselves)
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes if present
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  console.log("Loaded .env.local successfully");
} catch (err) {
  console.warn("Could not load .env.local:", err instanceof Error ? err.message : err);
}

import { WebSocketServer, WebSocket } from "ws";
import { Client as SSHClient, ClientChannel } from "ssh2";
import { createServer } from "http";
import { parse as parseUrl } from "url";
import { execSync } from "child_process";
import jwt from "jsonwebtoken";

const PORT = process.env.SSH_WS_PORT ? parseInt(process.env.SSH_WS_PORT) : 3002;

// Prevent crash-looping on transient SSH/WebSocket errors
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (kept alive):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (kept alive):", reason);
});

// Kill any stale processes on our port before starting
function killStaleProcesses() {
  try {
    // Use fuser to kill any process using our port
    execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { stdio: "ignore" });
    console.log(`Cleaned up any stale processes on port ${PORT}`);
  } catch {
    // Ignore errors - port might not be in use
  }
}

killStaleProcesses();

interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

const httpServer = createServer((req, res) => {
  res.writeHead(200);
  res.end("SSH WebSocket Server");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws: WebSocket, req) => {
  console.log("New WebSocket connection");

  const url = parseUrl(req.url || "", true);
  const query = url.query as Record<string, string>;

  let credentials: SSHCredentials;

  // Prefer signed token authentication (new secure method)
  if (query.token) {
    const wsSecret = process.env.ADMIN_JWT_SECRET;
    if (!wsSecret) {
      console.error("ADMIN_JWT_SECRET not configured for WebSocket auth");
      ws.send(JSON.stringify({ type: "error", message: "Server configuration error" }));
      ws.close();
      return;
    }

    try {
      const decoded = jwt.verify(query.token, wsSecret, { algorithms: ['HS256'] }) as {
        type: string;
        ssh: SSHCredentials;
      };

      if (decoded.type !== "ssh-session") {
        throw new Error("Invalid token type");
      }

      credentials = decoded.ssh;
    } catch (err) {
      console.error("WebSocket auth failed:", err instanceof Error ? err.message : err);
      ws.send(JSON.stringify({ type: "error", message: "Authentication failed" }));
      ws.close();
      return;
    }
  } else {
    console.error("Missing authentication: provide token or SSH credentials");
    ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
    ws.close();
    return;
  }

  console.log(`Connecting to ${credentials.username}@${credentials.host}:${credentials.port}`);

  const ssh = new SSHClient();
  let stream: ClientChannel | null = null;
  let pendingResize: { rows: number; cols: number } | null = null;

  ssh.on("ready", () => {
    console.log("SSH connection ready");

    ssh.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (err, shellStream) => {
      if (err) {
        console.error("Shell error:", err);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        ws.close();
        return;
      }

      stream = shellStream;

      // Apply any pending resize that came before shell was ready
      if (pendingResize) {
        console.log(`Applying pending resize: ${pendingResize.cols}x${pendingResize.rows}`);
        stream.setWindow(pendingResize.rows, pendingResize.cols, 0, 0);
        pendingResize = null;
      }

      // NOW send connected, after shell is ready
      ws.send(JSON.stringify({ type: "connected" }));

      stream.on("data", (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: data.toString("base64") }));
        }
      });

      stream.on("close", () => {
        console.log("SSH stream closed");
        ws.close();
      });

      stream.stderr.on("data", (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: data.toString("base64") }));
        }
      });
    });
  });

  ssh.on("error", (err) => {
    console.error("SSH error:", err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
      ws.close();
    }
  });

  ssh.on("close", () => {
    console.log("SSH connection closed");
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on("message", (message: Buffer | string) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === "data" && stream) {
        const data = Buffer.from(msg.data, "base64");
        stream.write(data);
      } else if (msg.type === "resize") {
        if (stream) {
          console.log(`Resize: ${msg.cols}x${msg.rows}`);
          stream.setWindow(msg.rows, msg.cols, 0, 0);
        } else {
          // Queue for when stream is ready
          console.log(`Queueing resize: ${msg.cols}x${msg.rows}`);
          pendingResize = { rows: msg.rows, cols: msg.cols };
        }
      }
    } catch (err) {
      console.error("Message parse error:", err);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket closed");
    ssh.end();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    ssh.end();
  });

  // Connect to SSH server
  ssh.connect({
    host: credentials.host,
    port: credentials.port,
    username: credentials.username,
    password: credentials.password,
    readyTimeout: 20000,
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`SSH WebSocket server running on 127.0.0.1:${PORT}`);
});
