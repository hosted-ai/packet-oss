import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getUnifiedInstances } from "@/lib/hostedai";
import { getExposedServices } from "@/lib/hostedai/services";
import { sendHfDeploymentEmail } from "@/lib/email";
import { createLoginLink } from "@/lib/customer-auth";
import { logActivity } from "@/lib/activity";
import {
  executeRemoteCommand,
  parseStatusOutput,
  getSSHCredentials,
  ERROR_MESSAGES,
  STATUS_CHECK_SCRIPT,
} from "@/lib/huggingface-status";

// Deployments older than this are auto-failed
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Max deployments to check per cron run
const MAX_PER_RUN = 10;

// Non-terminal statuses that need checking
const STUCK_STATUSES = ["pending", "deploying", "installing", "starting", "downloading"];

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results: Array<{ id: string; model: string; action: string; error?: string }> = [];

  try {
    // Find stuck deployments (non-terminal, created recently enough to still matter)
    const stuckDeployments = await prisma.huggingFaceDeployment.findMany({
      where: {
        status: { in: STUCK_STATUSES },
      },
      take: MAX_PER_RUN,
      orderBy: { createdAt: "asc" }, // oldest first
    });

    if (stuckDeployments.length === 0) {
      return NextResponse.json({ success: true, checked: 0, message: "No stuck deployments" });
    }

    console.log(`[HF Cron] Found ${stuckDeployments.length} stuck deployments to check`);
    const stripe = await getStripe();

    for (const deployment of stuckDeployments) {
      try {
        const ageMs = Date.now() - deployment.createdAt.getTime();

        // Auto-fail deployments older than 2 hours
        if (ageMs > MAX_AGE_MS) {
          console.log(`[HF Cron] Auto-failing deployment ${deployment.id} (${deployment.hfItemName}) — ${Math.round(ageMs / 60000)}min old`);
          await prisma.huggingFaceDeployment.update({
            where: { id: deployment.id },
            data: {
              status: "failed",
              errorMessage: ERROR_MESSAGES.DEPLOYMENT_TIMEOUT,
            },
          });

          // Send failure email
          await sendDeploymentEmail(stripe, deployment, "failed", ERROR_MESSAGES.DEPLOYMENT_TIMEOUT);

          results.push({ id: deployment.id, model: deployment.hfItemName, action: "timed_out" });
          continue;
        }

        // Get the customer's team ID from Stripe
        const customer = await stripe.customers.retrieve(deployment.stripeCustomerId);
        if ("deleted" in customer && customer.deleted) {
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "skipped", error: "customer deleted" });
          continue;
        }

        const teamId = customer.metadata?.hostedai_team_id;
        if (!teamId) {
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "skipped", error: "no team ID" });
          continue;
        }

        // HAI 2.2: Look up instance directly by the stored instance ID
        const instanceId = deployment.subscriptionId;

        const instancesResult = await getUnifiedInstances(teamId);
        const instance = instancesResult.items.find(i => i.id === instanceId);

        if (!instance) {
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "skipped", error: "instance not found" });
          continue;
        }

        const podStatusLower = (instance.status || "").toLowerCase();

        // Pod terminated
        if (["succeeded", "failed", "terminated", "stopped", "error", "crashloopbackoff"].includes(podStatusLower)) {
          console.log(`[HF Cron] Pod terminated for ${deployment.hfItemName}: ${instance.status}`);
          const errorMsg = `Pod terminated unexpectedly (${instance.status}). Please terminate this GPU and launch a new one.`;
          await prisma.huggingFaceDeployment.update({
            where: { id: deployment.id },
            data: { status: "failed", errorMessage: errorMsg },
          });
          await sendDeploymentEmail(stripe, deployment, "failed", errorMsg);
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "failed_pod_terminated" });
          continue;
        }

        // Pod not running — skip, let it boot
        if (podStatusLower !== "running") {
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "skipped", error: "pod not running" });
          continue;
        }

        // HAI 2.2: Get SSH credentials via instance credentials API
        const creds = await getSSHCredentials(instance.id, 1);
        if (!creds) {
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "skipped", error: "credentials not ready" });
          continue;
        }

        // SSH in and check status
        const sshResult = await executeRemoteCommand(creds.host, creds.port, creds.username, creds.password, STATUS_CHECK_SCRIPT);

        if (!sshResult.success) {
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "skipped", error: "SSH failed" });
          continue;
        }

        const { status, errorType } = parseStatusOutput(sshResult.output);

        if (status === "running") {
          console.log(`[HF Cron] Deployment ${deployment.hfItemName} is now running!`);
          await prisma.huggingFaceDeployment.update({
            where: { id: deployment.id },
            data: { status: "running", errorMessage: null },
          });

          // Auto-expose port 8000 via exposed-services API
          try {
            const existingServices = await getExposedServices(instance.id);
            const alreadyExposed = existingServices.some((s) => s.internal_port === 8000);
            if (!alreadyExposed) {
              // Use the legacy expose-service endpoint which still works for unified instances
              const { exposeService } = await import("@/lib/hostedai/services");
              await exposeService({
                pod_name: instance.id,
                port: 8000,
                service_name: "vllm",
                protocol: "TCP",
                service_type: "http",
              });
            }
          } catch (exposeErr) {
            console.error(`[HF Cron] Failed to auto-expose port:`, exposeErr);
          }

          await sendDeploymentEmail(stripe, deployment, "success");
          await logActivity(deployment.stripeCustomerId, "hf_deployment_running", `HuggingFace deployment running: ${deployment.hfItemName}`, { deploymentId: deployment.id });
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "running" });
        } else if (status === "failed") {
          const errorMsg = (errorType && ERROR_MESSAGES[errorType]) || "Deployment failed";
          console.log(`[HF Cron] Deployment ${deployment.hfItemName} failed: ${errorType}`);
          await prisma.huggingFaceDeployment.update({
            where: { id: deployment.id },
            data: { status: "failed", errorMessage: errorMsg },
          });
          await sendDeploymentEmail(stripe, deployment, "failed", errorMsg);
          await logActivity(deployment.stripeCustomerId, "hf_deployment_failed", `HuggingFace deployment failed: ${deployment.hfItemName}`, { deploymentId: deployment.id, errorType });
          results.push({ id: deployment.id, model: deployment.hfItemName, action: "failed", error: errorType });
        } else {
          // Still in progress — skip
          results.push({ id: deployment.id, model: deployment.hfItemName, action: `still_${status}` });
        }
      } catch (deployErr) {
        console.error(`[HF Cron] Error checking deployment ${deployment.id}:`, deployErr);
        results.push({
          id: deployment.id,
          model: deployment.hfItemName,
          action: "error",
          error: deployErr instanceof Error ? deployErr.message : String(deployErr),
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[HF Cron] Done in ${duration}ms: ${results.length} checked`);

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      checked: results.length,
      results,
    });
  } catch (error) {
    console.error("[HF Cron] Fatal error:", error);
    return NextResponse.json(
      { error: "Failed to check HF deployments", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// GET calls POST (for manual testing via browser)
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * Send deployment status email to customer
 */
async function sendDeploymentEmail(
  stripe: Awaited<ReturnType<typeof getStripe>>,
  deployment: { stripeCustomerId: string; hfItemName: string },
  status: "success" | "failed",
  errorMessage?: string,
) {
  try {
    const customer = await stripe.customers.retrieve(deployment.stripeCustomerId);
    if ("deleted" in customer || !customer.email) return;

    const token = await createLoginLink({ email: customer.email.toLowerCase(), customerId: customer.id });
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${encodeURIComponent(token)}`;

    await sendHfDeploymentEmail({
      to: customer.email,
      customerName: customer.name || customer.email.split("@")[0],
      modelName: deployment.hfItemName,
      status,
      errorMessage,
      dashboardUrl,
    });
    console.log(`[HF Cron] Sent ${status} email to ${customer.email} for ${deployment.hfItemName}`);
  } catch (emailErr) {
    console.error(`[HF Cron] Failed to send email:`, emailErr);
  }
}
