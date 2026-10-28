/**
 * Wallet-depletion enforcement.
 *
 * When a customer's wallet goes negative, the sync billing engine terminates
 * their pods to stop the bleed. Only HOURLY (wallet-funded) pods should be
 * affected: a MONTHLY-subscription pod is paid through Stripe, independent of
 * the wallet, so it must survive when the wallet hits zero.
 *
 * Classification has three outcomes, not two. "Monthly" and "hourly" are facts
 * Packet knows; an instance with no billing metadata — one deployed outside
 * Packet, on the user panel — is simply unknown, and only "hourly" licenses a
 * termination. An unclassifiable instance is skipped and reported: wrongly
 * keeping one costs a small billing leak, wrongly deleting one costs a
 * customer their workload.
 */
export interface PodBilling {
  billingType?: string | null;
  stripeSubscriptionId?: string | null;
}

export type PodBillingClass = "monthly" | "hourly" | "unknown";

// How long a team's shared storage survives after its pods are terminated for
// a negative balance; topping up within the window cancels the deletion.
export const VOLUME_DELETION_GRACE_DAYS = 3;

export function classifyPodBilling(
  meta: PodBilling | undefined | null,
): PodBillingClass {
  if (!meta) return "unknown";
  if (meta.billingType === "monthly" || meta.stripeSubscriptionId) return "monthly";
  if (meta.billingType === "hourly") return "hourly";
  return "unknown";
}

export function isMonthlyPod(meta: PodBilling | undefined | null): boolean {
  return classifyPodBilling(meta) === "monthly";
}

// managedBy says who launched the pod, never how it is funded, so it takes no
// part in the test below.
export interface PodWorkload extends PodBilling {
  hourlyRateCents?: number | null;
  managedBy?: string | null;
}

// A wallet-funded hourly pod, by class or by rate, whoever manages it — a
// monthly pod is paid through Stripe and never counts, however it is rated.
export function isHourlyWorkload(pod: PodWorkload): boolean {
  if (isMonthlyPod(pod)) return false;
  return pod.billingType === "hourly" || (pod.hourlyRateCents ?? 0) > 0;
}

// Emit the one line that makes a refused termination visible, so a skip is
// auditable rather than silent.
export function logUnclassifiedSkip(
  source: string,
  instanceId: string,
  reason: string,
): void {
  console.warn(
    `[${source}] Skipping termination of instance ${instanceId}: ${reason} — Packet cannot classify its billing, and an unclassifiable instance is reported, never terminated`,
  );
}

// Split active instance ids three ways: hourly to terminate, monthly to keep,
// and unclassifiable to skip and report.
export function selectPodsToTerminate(
  activeInstanceIds: string[],
  metaByInstance: Map<string, PodBilling>,
): { terminate: string[]; keepMonthly: string[]; skipUnclassified: string[] } {
  const terminate: string[] = [];
  const keepMonthly: string[] = [];
  const skipUnclassified: string[] = [];
  for (const id of activeInstanceIds) {
    switch (classifyPodBilling(metaByInstance.get(id))) {
      case "monthly":
        keepMonthly.push(id);
        break;
      case "hourly":
        terminate.push(id);
        break;
      default:
        skipUnclassified.push(id);
    }
  }
  return { terminate, keepMonthly, skipUnclassified };
}
