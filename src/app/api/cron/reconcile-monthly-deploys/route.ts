// Re-attach a monthly subscription to the pod it deployed when the PodMetadata
// row tying them was never written. Repairs only an unambiguous match.
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getUnifiedInstances } from "@/lib/hostedai";
import { randomBytes } from "crypto";

// A deploy that is still provisioning has not necessarily written its row yet.
const SETTLE_MS = 15 * 60 * 1000;
const MAX_SUBS_PER_RUN = 50;

type Outcome =
  | "linked"
  | "converted"
  | "not_deployed"
  | "already_linked"
  | "ambiguous"
  | "no_team"
  | "error";

async function handler(request: NextRequest): Promise<NextResponse> {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const stripe = await getStripe();
  const results: Array<{ subscription: string; outcome: Outcome; instance?: string }> = [];

  let subs: Stripe.Subscription[];
  try {
    const page = await stripe.subscriptions.list({ status: "active", limit: 100 });
    subs = page.data.slice(0, MAX_SUBS_PER_RUN);
  } catch (err) {
    console.error("[ReconcileMonthlyDeploys] Could not list subscriptions:", err);
    return NextResponse.json({ success: false, error: "stripe_list_failed" }, { status: 502 });
  }

  const cutoff = Date.now() - SETTLE_MS;

  for (const sub of subs) {
    if (sub.created * 1000 > cutoff) continue; // give the deploy time to land
    const priceId = sub.items?.data?.[0]?.price?.id;
    if (!priceId) continue;

    try {
      const product = await prisma.gpuProduct.findFirst({
        where: { stripePriceId: priceId, billingType: "monthly" },
      });
      if (!product) continue; // not a GPU subscription

      const linked = await prisma.podMetadata.findFirst({
        where: { stripeSubscriptionId: sub.id },
        select: { id: true },
      });
      if (linked) {
        results.push({ subscription: sub.id, outcome: "already_linked" });
        continue;
      }

      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const cached = await prisma.customerCache.findUnique({ where: { id: customerId } });
      // A monthly customer carries no team of its own; the team lives on the
      // primary it was cross-linked to at checkout.
      let teamId = cached?.teamId || null;
      if (!teamId && cached?.email) {
        const primary = await prisma.customerCache.findFirst({
          where: { email: cached.email, teamId: { not: null } },
        });
        teamId = primary?.teamId || null;
      }
      if (!teamId) {
        results.push({ subscription: sub.id, outcome: "no_team" });
        continue;
      }

      const { items } = await getUnifiedInstances(teamId);
      const live = (items || []).filter((i) => {
        const s = (i.status || "").toLowerCase();
        return s === "running" || s === "active";
      });
      if (live.length === 0) {
        results.push({ subscription: sub.id, outcome: "not_deployed" });
        continue;
      }

      // A pod adopted by the sync sweep keeps its instance id in subscriptionId
      // with instanceId NULL, so matching on instanceId alone mints a duplicate.
      const liveIds = live.map((i) => i.id);
      const existing = await prisma.podMetadata.findMany({
        where: {
          OR: [
            { instanceId: { in: liveIds } },
            { subscriptionId: { in: liveIds } },
            { subscriptionId: { in: liveIds.map((id) => `instance-${id}`) } },
          ],
        },
        select: { id: true, subscriptionId: true, instanceId: true, stripeSubscriptionId: true },
      });

      const rowFor = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        const key = row.instanceId ?? row.subscriptionId.replace(/^instance-/, "");
        // A row naming the subscription wins over a bare adopted one.
        if (!rowFor.has(key) || row.stripeSubscriptionId) rowFor.set(key, row);
      }

      // An adopted row still counts as unlinked — it is the thing to repair.
      const orphans = live.filter((i) => !rowFor.get(i.id)?.stripeSubscriptionId);

      if (orphans.length === 0) {
        results.push({ subscription: sub.id, outcome: "not_deployed" });
        continue;
      }
      if (orphans.length > 1) {
        console.warn(
          `[ReconcileMonthlyDeploys] ${sub.id} has ${orphans.length} unattached instances — not guessing which one it paid for`,
        );
        results.push({ subscription: sub.id, outcome: "ambiguous" });
        continue;
      }

      const instance = orphans[0];
      const adopted = rowFor.get(instance.id);
      // Only a pod that appeared after the purchase can be what it paid for;
      // an older metered pod is the customer's own hourly work, not this.
      const deployedAfterPurchase =
        !!instance.created_at && new Date(instance.created_at).getTime() >= sub.created * 1000;
      if (adopted && !deployedAfterPurchase) {
        results.push({ subscription: sub.id, outcome: "not_deployed" });
        continue;
      }
      if (adopted) {
        // Convert rather than add a second row: leaving the metered one in
        // place is what charged a monthly customer by the half hour.
        await prisma.podMetadata.update({
          where: { id: adopted.id },
          data: {
            instanceId: instance.id,
            stripeSubscriptionId: sub.id,
            billingType: "monthly",
            hourlyRateCents: 0,
            prepaidUntil: null,
            // The platform listed it running above. Left NULL, Packet v2's console reads
            // the pod as terminated and the customer cannot see what they pay for.
            deployStatus: "running",
          },
        });
        console.log(
          `[ReconcileMonthlyDeploys] Converted adopted row ${adopted.id} for ${instance.id} to ${sub.id} (team ${teamId})`,
        );
        results.push({ subscription: sub.id, outcome: "converted", instance: instance.id });
        continue;
      }

      const podInfo = instance.pod_info as { pool_id?: number | string } | null;
      const deployTime = instance.created_at ? new Date(instance.created_at) : new Date();
      await prisma.podMetadata.create({
        data: {
          subscriptionId: `instance-${instance.id}`,
          instanceId: instance.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          billingType: "monthly",
          // Running on the platform, as filtered above; NULL reads as terminated in v2.
          deployStatus: "running",
          displayName: instance.name || null,
          productId: product.id,
          poolId: podInfo?.pool_id != null ? String(podInfo.pool_id) : null,
          hourlyRateCents: 0,
          prepaidAmountCents: 0,
          prepaidUntil: null,
          deployTime,
          metricsToken: randomBytes(32).toString("hex"),
          tenantId: "default",
        },
      });
      console.log(
        `[ReconcileMonthlyDeploys] Linked ${sub.id} to running instance ${instance.id} (team ${teamId})`,
      );
      results.push({ subscription: sub.id, outcome: "linked", instance: instance.id });
    } catch (err) {
      console.error(`[ReconcileMonthlyDeploys] ${sub.id} failed:`, err);
      results.push({ subscription: sub.id, outcome: "error" });
    }
  }

  const linked = results.filter((r) => r.outcome === "linked" || r.outcome === "converted").length;
  const ambiguous = results.filter((r) => r.outcome === "ambiguous").length;
  const errors = results.filter((r) => r.outcome === "error").length;
  if (linked || ambiguous || errors) {
    console.log(
      `[ReconcileMonthlyDeploys] checked=${results.length} linked=${linked} ambiguous=${ambiguous} errors=${errors}`,
    );
  }
  return NextResponse.json({ success: true, checked: results.length, linked, ambiguous, errors, results });
}

export const GET = handler;
export const POST = handler;
