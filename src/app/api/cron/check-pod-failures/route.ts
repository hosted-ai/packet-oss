/**
 * CRON: Check Pod Failures (Every 5 minutes)
 *
 * Scans active pods for failed states. When a new failure is detected:
 * 1. Creates an URGENT Zammad support ticket
 * 2. Sends an email to support@hosted.ai with full debugging info
 * 3. Records the alert in PodFailureAlert to prevent duplicates
 *
 * OPTIMIZED: Uses pool overview cache to identify teams with active pods,
 * and CustomerCache for customer info. Only calls hosted.ai for teams
 * that actually have pods, instead of ALL teams in the resource policy.
 *
 * Triggered by cron-job.org every 5 minutes:
 * GET /api/cron/check-pod-failures?secret=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPoolSubscriptions } from "@/lib/hostedai";
import { verifyCronAuth } from "@/lib/cron-auth";
import { isPro } from "@/lib/edition";
import { sendPodFailureAlertEmail } from "@/lib/email/templates/pod-failure";
import { readPoolOverviewCache } from "@/lib/pool-overview";

// Zammad is Pro-only — dynamically import to avoid build errors in OSS
type CreateTicketFn = typeof import("@/lib/zammad/client").createTicket;
let createTicket: CreateTicketFn | null = null;
if (isPro()) {
  import("@/lib/zammad/client")
    .then((mod) => { createTicket = mod.createTicket; })
    .catch(() => { /* Zammad not available */ });
}

// Pod statuses that indicate failure
const FAILED_STATUSES = new Set([
  "failed",
  "error",
  "crash_loop",
  "crashloopbackoff",
  "oom_killed",
  "evicted",
]);

const PACKET_SUPPORT_GROUP = process.env.ZAMMAD_SUPPORT_GROUP || "Support::L1 - packet.ai";

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed: rejects if CRON_SECRET is not set)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results = {
    teamsChecked: 0,
    podsChecked: 0,
    failuresDetected: 0,
    ticketsCreated: 0,
    emailsSent: 0,
    alreadyAlerted: 0,
    errors: [] as string[],
  };

  try {
    // Step 1: Get teams with active pods from pool overview cache (local file, 0 API calls)
    // This narrows from ~70 teams to ~20-30 that actually have pods
    const poolCache = readPoolOverviewCache();
    const activeTeamIds = new Set<string>();
    const teamEmailFromCache = new Map<string, string | null>();

    if (poolCache?.pools) {
      for (const pool of poolCache.pools) {
        for (const pod of pool.pods || []) {
          if (pod.teamId && ["subscribed", "active", "running"].includes(pod.status)) {
            activeTeamIds.add(pod.teamId);
            if (pod.customerEmail) {
              teamEmailFromCache.set(pod.teamId, pod.customerEmail);
            }
          }
        }
      }
    }

    if (activeTeamIds.size === 0) {
      console.log("[Pod Failures] No active teams found in pool overview cache");
      return NextResponse.json({ success: true, duration: `${Date.now() - startTime}ms`, results });
    }

    results.teamsChecked = activeTeamIds.size;
    console.log(`[Pod Failures] Checking ${activeTeamIds.size} teams with active pods (from cache)...`);

    // Step 2: Get customer info from local CustomerCache (0 Stripe API calls)
    const customerCacheList = await prisma.customerCache.findMany({
      where: { teamId: { in: Array.from(activeTeamIds) }, isDeleted: false },
      select: { id: true, teamId: true, email: true },
    });
    const teamToCustomer = new Map<string, { customerId: string; email: string | null }>();
    for (const c of customerCacheList) {
      if (c.teamId) {
        teamToCustomer.set(c.teamId, { customerId: c.id, email: c.email });
      }
    }
    // Fill gaps from the pool overview cache
    for (const [teamId, email] of teamEmailFromCache) {
      if (!teamToCustomer.has(teamId) && email) {
        teamToCustomer.set(teamId, { customerId: "", email });
      }
    }

    // Track which pods are currently failed (for cleanup in Step 4)
    const stillFailedKeys = new Set<string>();

    // Step 3: Check each team with active pods for failures
    // Only these teams need a hosted.ai API call
    for (const teamId of activeTeamIds) {
      try {
        const subscriptions = await getPoolSubscriptions(teamId);

        for (const sub of subscriptions) {
          // Only check subscriptions that have pods
          if (!sub.pods || sub.pods.length === 0) continue;

          for (const pod of sub.pods) {
            const podStatus = (pod.pod_status || "").toLowerCase().trim();

            // Track all currently-failed pods regardless of subscription status
            if (FAILED_STATUSES.has(podStatus)) {
              stillFailedKeys.add(`${sub.id}|${pod.pod_name}`);
            }

            // Only alert for active/subscribed subscriptions
            if (sub.status !== "subscribed" && sub.status !== "active") continue;

            results.podsChecked++;
            if (!FAILED_STATUSES.has(podStatus)) continue;

            results.failuresDetected++;
            const subId = String(sub.id);

            // Check if we already alerted for this pod
            const existing = await prisma.podFailureAlert.findUnique({
              where: {
                subscriptionId_podName: {
                  subscriptionId: subId,
                  podName: pod.pod_name,
                },
              },
            });

            if (existing) {
              results.alreadyAlerted++;
              continue;
            }

            // New failure — create ticket and send email
            const customer = teamToCustomer.get(teamId);
            const customerEmail = customer?.email || null;
            const poolName = sub.pool_name || null;
            const gpuCount = pod.gpu_count || sub.per_pod_info?.vgpu_count || 1;
            const region = sub.region?.region_name || sub.region?.city || null;

            console.log(`[Pod Failures] New failure: pod=${pod.pod_name} status=${podStatus} team=${teamId} customer=${customerEmail}`);

            // Create Zammad ticket (Pro only — skipped in OSS)
            let zammadTicketId: number | null = null;
            if (createTicket) {
              try {
                const ticketBody = [
                  `A customer pod has entered **${podStatus}** status and requires immediate attention.`,
                  "",
                  "**Pod Details:**",
                  `- Pod Name: ${pod.pod_name}`,
                  `- Pod Status: ${podStatus}`,
                  `- Subscription ID: ${subId}`,
                  `- Team ID: ${teamId}`,
                  `- Customer Email: ${customerEmail || "unknown"}`,
                  `- Pool: ${poolName || "unknown"}`,
                  `- GPU Count: ${gpuCount}`,
                  `- Region: ${region || "unknown"}`,
                  "",
                  `Admin Panel: ${process.env.NEXT_PUBLIC_APP_URL || "https://localhost:3000"}/admin?tab=pods`,
                ].join("\n");

                const ticket = await createTicket({
                  title: `[URGENT] Pod Failed: ${pod.pod_name} (${customerEmail || teamId})`,
                  group: PACKET_SUPPORT_GROUP,
                  customer_id: 1, // System/admin user in Zammad
                  priority_id: 3, // High/urgent
                  article: {
                    subject: `Pod Failed: ${pod.pod_name}`,
                    body: ticketBody,
                    type: "note",
                    sender: "Agent",
                    internal: false,
                  },
                });
                zammadTicketId = ticket.id;
                results.ticketsCreated++;
                console.log(`[Pod Failures] Created Zammad ticket #${ticket.id} for pod ${pod.pod_name}`);
              } catch (ticketErr) {
                const msg = `Failed to create Zammad ticket for pod ${pod.pod_name}: ${ticketErr}`;
                console.error(`[Pod Failures] ${msg}`);
                results.errors.push(msg);
              }
            }

            // Send email to support@hosted.ai
            try {
              await sendPodFailureAlertEmail({
                podName: pod.pod_name,
                podStatus,
                subscriptionId: subId,
                teamId,
                customerEmail,
                poolName,
                gpuCount,
                region,
                zammadTicketId,
              });
              results.emailsSent++;
              console.log(`[Pod Failures] Sent failure email for pod ${pod.pod_name}`);
            } catch (emailErr) {
              const msg = `Failed to send email for pod ${pod.pod_name}: ${emailErr}`;
              console.error(`[Pod Failures] ${msg}`);
              results.errors.push(msg);
            }

            // Record the alert for deduplication
            try {
              await prisma.podFailureAlert.create({
                data: {
                  subscriptionId: subId,
                  podName: pod.pod_name,
                  teamId,
                  customerEmail,
                  poolName,
                  podStatus,
                  zammadTicketId,
                },
              });
            } catch (dbErr) {
              // Unique constraint violation means another run beat us — safe to ignore
              console.warn(`[Pod Failures] Could not record alert for ${pod.pod_name}:`, dbErr);
            }
          }
        }
      } catch (teamErr) {
        const msg = `Error checking team ${teamId}: ${teamErr}`;
        console.error(`[Pod Failures] ${msg}`);
        results.errors.push(msg);
      }
    }

    // Step 4: Clean up alerts for pods that have RECOVERED (no longer failed).
    try {
      const allAlerts = await prisma.podFailureAlert.findMany();
      const toDelete = allAlerts.filter(
        (a) => !stillFailedKeys.has(`${a.subscriptionId}|${a.podName}`)
      );

      if (toDelete.length > 0) {
        await prisma.podFailureAlert.deleteMany({
          where: { id: { in: toDelete.map((a) => a.id) } },
        });
        console.log(`[Pod Failures] Cleaned up ${toDelete.length} alerts for recovered pods`);
      }
    } catch (cleanupErr) {
      console.warn("[Pod Failures] Cleanup error:", cleanupErr);
    }

    const duration = Date.now() - startTime;
    console.log(`[Pod Failures] Complete in ${duration}ms:`, results);

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      results,
    });
  } catch (error) {
    console.error("[Pod Failures] Cron job failed:", error);
    return NextResponse.json(
      { error: "Pod failure check failed", details: String(error) },
      { status: 500 }
    );
  }
}
