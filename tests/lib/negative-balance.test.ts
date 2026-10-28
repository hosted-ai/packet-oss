import { describe, it, expect } from "vitest";
import {
  classifyPodBilling,
  isHourlyWorkload,
  isMonthlyPod,
  selectPodsToTerminate,
  type PodBilling,
  type PodWorkload,
} from "@/lib/negative-balance";

describe("classifyPodBilling", () => {
  it("classifies billingType=monthly as monthly", () => {
    expect(classifyPodBilling({ billingType: "monthly" })).toBe("monthly");
  });
  it("classifies a Stripe subscription id as monthly", () => {
    expect(classifyPodBilling({ stripeSubscriptionId: "sub_123" })).toBe("monthly");
  });
  it("classifies billingType=hourly as hourly", () => {
    expect(classifyPodBilling({ billingType: "hourly" })).toBe("hourly");
  });
  it("separates an instance it has never heard of from a known hourly one", () => {
    expect(classifyPodBilling(undefined)).toBe("unknown");
    expect(classifyPodBilling(null)).toBe("unknown");
    expect(classifyPodBilling({})).toBe("unknown");
  });
});

describe("isMonthlyPod", () => {
  it("is true only for monthly", () => {
    expect(isMonthlyPod({ billingType: "monthly" })).toBe(true);
    expect(isMonthlyPod({ stripeSubscriptionId: "sub_123" })).toBe(true);
    expect(isMonthlyPod({ billingType: "hourly" })).toBe(false);
    expect(isMonthlyPod(undefined)).toBe(false);
  });
});

describe("isHourlyWorkload", () => {
  it("counts an engine-managed hourly instance, so its customer is enforced", () => {
    expect(isHourlyWorkload({ billingType: "hourly", hourlyRateCents: 500, managedBy: "engine" })).toBe(true);
    expect(isHourlyWorkload({ hourlyRateCents: 500, managedBy: "engine" })).toBe(true);
  });

  it("counts an hourly instance Packet never gave a rate", () => {
    expect(isHourlyWorkload({ billingType: "hourly" })).toBe(true);
    expect(isHourlyWorkload({ billingType: "hourly", hourlyRateCents: 0 })).toBe(true);
    expect(isHourlyWorkload({ billingType: "hourly", hourlyRateCents: null })).toBe(true);
  });

  it("never counts a monthly instance, however it is rated", () => {
    expect(isHourlyWorkload({ billingType: "monthly", hourlyRateCents: 500 })).toBe(false);
    expect(isHourlyWorkload({ stripeSubscriptionId: "sub_123", hourlyRateCents: 500 })).toBe(false);
  });

  it("never counts an instance it cannot classify and has no rate for", () => {
    expect(isHourlyWorkload({})).toBe(false);
    expect(isHourlyWorkload({ billingType: null, hourlyRateCents: null })).toBe(false);
  });

  // The enforcement gate: it runs on a customer holding any hourly workload and
  // skips one holding none.
  it("gates enforcement per customer", () => {
    const monthlyOnlyWithStaleStripeMetadata: PodWorkload[] = [
      { billingType: "monthly", hourlyRateCents: 900 },
      { stripeSubscriptionId: "sub_1" },
    ];
    const engineOnly: PodWorkload[] = [{ billingType: "hourly", hourlyRateCents: 250, managedBy: "engine" }];
    const noHourlyWorkload: PodWorkload[] = [{}, { billingType: null }];

    expect(monthlyOnlyWithStaleStripeMetadata.filter(isHourlyWorkload)).toHaveLength(0);
    expect(engineOnly.filter(isHourlyWorkload)).toHaveLength(1);
    expect(noHourlyWorkload.filter(isHourlyWorkload)).toHaveLength(0);
  });
});

describe("selectPodsToTerminate", () => {
  it("terminates only the hourly pod, keeps the monthly subscription pod", () => {
    const meta = new Map<string, PodBilling>([
      ["i-monthly", { billingType: "monthly", stripeSubscriptionId: "sub_1" }],
      ["i-hourly", { billingType: "hourly" }],
    ]);
    const r = selectPodsToTerminate(["i-monthly", "i-hourly"], meta);
    expect(r.terminate).toEqual(["i-hourly"]);
    expect(r.keepMonthly).toEqual(["i-monthly"]);
    expect(r.skipUnclassified).toEqual([]);
  });

  it("never terminates an instance it cannot classify", () => {
    const r = selectPodsToTerminate(["i-user-panel"], new Map());
    expect(r.terminate).toEqual([]);
    expect(r.skipUnclassified).toEqual(["i-user-panel"]);
  });

  it("keeps all pods when every one is monthly (nothing to terminate)", () => {
    const meta = new Map<string, PodBilling>([
      ["i-m1", { billingType: "monthly" }],
      ["i-m2", { stripeSubscriptionId: "sub_2" }],
    ]);
    const r = selectPodsToTerminate(["i-m1", "i-m2"], meta);
    expect(r.terminate).toEqual([]);
    expect(r.keepMonthly).toEqual(["i-m1", "i-m2"]);
  });
});
