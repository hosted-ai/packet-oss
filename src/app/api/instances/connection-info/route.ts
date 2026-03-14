import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  getConnectionInfo,
  getInstanceCredentials,
  getTeamInstances,
  SubscriptionConnectionInfo,
  PodConnectionInfo,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import { spawn } from "child_process";
import { validateSSHParams } from "@/lib/ssh-validation";

// In-memory cache for connection info (2 minute TTL, reduced to prevent stale data)
const connectionInfoCache = new Map<string, {
  data: SubscriptionConnectionInfo[];
  timestamp: number;
}>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes (reduced from 5)

// Parse SSH command to extract host, port, and username
function parseSSHCommand(cmd: string): { host: string; port: number; username: string } {
  const parts = cmd.trim().split(/\s+/);
  const userHostPart = parts.find(p => p.includes("@"));

  let username = "root";
  let host = "localhost";
  if (userHostPart) {
    const [user, h] = userHostPart.split("@");
    username = user;
    host = h;
  }

  let port = 22;
  const portFlagIndex = parts.indexOf("-p");
  if (portFlagIndex !== -1 && parts[portFlagIndex + 1]) {
    port = parseInt(parts[portFlagIndex + 1], 10);
  }

  return { host, port, username };
}

// Fetch internal IP via SSH command
async function fetchInternalIP(
  host: string,
  port: number,
  username: string,
  password: string,
  timeoutMs: number = 10000
): Promise<string | null> {
  // Validate SSH parameters to prevent command injection
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
    // Use hostname -I to get internal IPs, take the first one
    const command = "hostname -I | awk '{print $1}'";

    const args = [
      "-e", // Use SSHPASS environment variable
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=5",
      "-p", String(port),
      `${username}@${host}`,
      command
    ];

    const proc = spawn("sshpass", args, {
      timeout: timeoutMs,
      env: { ...process.env, SSHPASS: password },
    });

    let stdout = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        const ip = stdout.trim();
        // Validate it looks like an IP address
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
          resolve(ip);
        } else {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
}

// GET - Get connection info (SSH credentials) for pool subscriptions
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, allTeamIds } = auth;

    if (!allTeamIds.length) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Get optional subscription_id/instance_id and refresh flag from query params
    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get("subscription_id");
    const instanceId = searchParams.get("instance_id");
    const forceRefresh = searchParams.get("refresh") === "true";

    // === HAI 2.2: Single instance credentials ===
    if (instanceId) {
      try {
        const creds = await getInstanceCredentials(instanceId);
        // Format as SubscriptionConnectionInfo for frontend compatibility
        const sshCmd = creds.ip && creds.port && creds.username
          ? `ssh -p ${creds.port} ${creds.username}@${creds.ip}`
          : undefined;

        const podInfo: PodConnectionInfo = {
          pod_name: instanceId,
          pod_status: "running",
          ssh_info: sshCmd && creds.password ? { cmd: sshCmd, pass: creds.password } : undefined,
        };

        // Try to enrich with internal IP
        if (creds.ip && creds.port && creds.username && creds.password) {
          try {
            const internalIP = await fetchInternalIP(
              creds.ip, creds.port, creds.username, creds.password
            );
            if (internalIP) {
              podInfo.internal_ip = internalIP;
            }
          } catch { /* ignore */ }
        }

        // Get the display name from metadata if available
        const meta = await prisma.podMetadata.findFirst({
          where: { instanceId },
          select: { displayName: true },
        }).catch(() => null);

        const result: SubscriptionConnectionInfo = {
          id: 0, // Not a pool subscription
          pool_name: meta?.displayName || "GPU Instance",
          region_id: 0,
          pods: [podInfo],
        };

        return NextResponse.json({ connectionInfo: [result], instanceCredentials: creds });
      } catch (error) {
        console.error(`[ConnectionInfo] Failed to fetch instance credentials for ${instanceId}:`, error);
        return NextResponse.json(
          { error: "Failed to get instance credentials" },
          { status: 500 }
        );
      }
    }

    // Check cache first (unless refresh is requested) — use all team IDs as cache key
    const cacheKey = `${allTeamIds.sort().join("+")}:${subscriptionId || "all"}`;
    const cached = connectionInfoCache.get(cacheKey);
    const now = Date.now();

    if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      // Don't serve from cache if SSH info is missing for any running pod
      const hasMissingSSH = cached.data.some(sub =>
        sub.pods.some(pod =>
          pod.pod_status?.toLowerCase() === "running" && !pod.ssh_info?.cmd
        )
      );
      if (!hasMissingSSH) {
        console.log(`[ConnectionInfo] Cache hit for ${cacheKey}`);
        return NextResponse.json({ connectionInfo: cached.data });
      }
      console.log(`[ConnectionInfo] Cache has missing SSH info, refreshing for ${cacheKey}`);
    }

    console.log(`[ConnectionInfo] Cache miss for ${cacheKey}, fetching from hosted.ai for ${allTeamIds.length} team(s)`);

    // Get connection info from ALL teams (handles multi-account customers)
    const allConnectionInfo = await Promise.all(
      allTeamIds.map(async (tid) => {
        try {
          return await getConnectionInfo(tid, subscriptionId || undefined);
        } catch (error) {
          console.error(`[ConnectionInfo] Failed to fetch for team ${tid}:`, error);
          return [];
        }
      })
    );

    // Merge and deduplicate by subscription ID
    const seenIds = new Set<number>();
    const connectionInfo: SubscriptionConnectionInfo[] = [];
    for (const teamResult of allConnectionInfo) {
      for (const sub of teamResult) {
        if (!seenIds.has(sub.id)) {
          seenIds.add(sub.id);
          connectionInfo.push(sub);
        }
      }
    }

    // Enrich pods with internal IP for running pods with SSH info
    const enrichedInfo: SubscriptionConnectionInfo[] = await Promise.all(
      connectionInfo.map(async (sub) => {
        const enrichedPods: PodConnectionInfo[] = await Promise.all(
          sub.pods.map(async (pod) => {
            // Only fetch internal IP if pod is running and has SSH info
            if (
              pod.pod_status?.toLowerCase() === "running" &&
              pod.ssh_info?.cmd &&
              pod.ssh_info?.pass
            ) {
              try {
                const { host, port, username } = parseSSHCommand(pod.ssh_info.cmd);
                const internalIP = await fetchInternalIP(
                  host,
                  port,
                  username,
                  pod.ssh_info.pass
                );
                return {
                  ...pod,
                  internal_ip: internalIP || undefined,
                };
              } catch (err) {
                console.error(`Failed to fetch internal IP for pod ${pod.pod_name}:`, err);
                return pod;
              }
            }
            return pod;
          })
        );

        return {
          ...sub,
          pods: enrichedPods,
        };
      })
    );

    // Only cache if all running pods have SSH info (otherwise keep fetching)
    const allHaveSSH = enrichedInfo.every(sub =>
      sub.pods.every(pod =>
        pod.pod_status?.toLowerCase() !== "running" || (pod.ssh_info?.cmd && pod.ssh_info?.pass)
      )
    );

    if (allHaveSSH) {
      connectionInfoCache.set(cacheKey, {
        data: enrichedInfo,
        timestamp: now,
      });
    } else {
      console.log(`[ConnectionInfo] Not caching - some pods missing SSH info`);
    }

    return NextResponse.json({ connectionInfo: enrichedInfo });
  } catch (error) {
    console.error("Get connection info error:", error);
    return NextResponse.json(
      { error: "Failed to get connection info" },
      { status: 500 }
    );
  }
}
