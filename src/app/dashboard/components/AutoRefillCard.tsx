"use client";

import { useState } from "react";

export interface AutoRefillSettings {
  enabled: boolean;
  amountCents: number;
  thresholdCents: number;
  hasPaymentMethod: boolean;
}

interface AutoRefillCardProps {
  settings: AutoRefillSettings | null;
  token: string;
  billingPortalUrl?: string;
  canManage: boolean;
}

/**
 * Customer-set auto-refill (PA-195). Opt-in: off until the customer turns it on.
 * "Top up $amount whenever my balance drops below $threshold." Saves to
 * /api/account/auto-refill (writes Stripe customer metadata).
 */
export function AutoRefillCard({ settings, token, billingPortalUrl, canManage }: AutoRefillCardProps) {
  const initial = {
    enabled: settings?.enabled ?? false,
    amount: ((settings?.amountCents ?? 10000) / 100).toString(),
    threshold: ((settings?.thresholdCents ?? 2500) / 100).toString(),
  };
  const [enabled, setEnabled] = useState(initial.enabled);
  const [amount, setAmount] = useState(initial.amount);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Last-persisted values; Save is a no-op (and shows no confirmation) unless the
  // form differs from these (PA-338).
  const [baseline, setBaseline] = useState(initial);

  const dirty =
    enabled !== baseline.enabled || amount !== baseline.amount || threshold !== baseline.threshold;

  const hasPaymentMethod = settings?.hasPaymentMethod ?? false;

  async function save(nextEnabled: boolean) {
    setSaving(true);
    setError(null);
    setSaved(false);

    const amountCents = Math.round(parseFloat(amount) * 100);
    const thresholdCents = Math.round(parseFloat(threshold) * 100);

    // Client-side guard for fast feedback; the server validates authoritatively.
    if (nextEnabled) {
      if (!Number.isFinite(amountCents) || amountCents < 1000) {
        setError("Refill amount must be at least $10.");
        setSaving(false);
        return;
      }
      if (!Number.isFinite(thresholdCents) || thresholdCents < 500) {
        setError("Threshold must be at least $5.");
        setSaving(false);
        return;
      }
      if (amountCents < thresholdCents) {
        setError("Refill amount must be at least the threshold.");
        setSaving(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/account/auto-refill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: nextEnabled, amountCents, thresholdCents }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to save.");
        return;
      }
      setEnabled(json.autoRefill.enabled);
      setBaseline({ enabled: json.autoRefill.enabled, amount, threshold });
      setSaved(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-24 pl-6 pr-2 py-1.5 rounded-lg border border-[var(--line)] text-sm text-[var(--ink)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-violet-300";

  return (
    <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-[var(--ink)]">Auto-Refill</div>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-md">
            Automatically top up your wallet so running GPUs aren&apos;t terminated when your balance runs low.
          </p>
        </div>
        <label className="inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            disabled={!canManage || saving}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <div className="relative w-11 h-6 bg-zinc-200 peer-checked:bg-violet-600 rounded-full transition-colors peer-disabled:opacity-50 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
        </label>
      </div>

      {enabled && (
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1">Top up by</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">$</span>
              <input
                type="number"
                min={10}
                step={10}
                value={amount}
                disabled={!canManage || saving}
                onChange={(e) => setAmount(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1">When below</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">$</span>
              <input
                type="number"
                min={5}
                step={5}
                value={threshold}
                disabled={!canManage || saving}
                onChange={(e) => setThreshold(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>
      )}

      {enabled && !hasPaymentMethod && (
        <p className="mt-3 text-xs text-amber-600">
          Auto-refill needs a saved card.{" "}
          {billingPortalUrl && (
            <a href={billingPortalUrl} className="underline hover:text-amber-700">
              Add a payment method
            </a>
          )}
        </p>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => save(enabled)}
          disabled={!canManage || saving || !dirty}
          className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !dirty && !error && <span className="text-xs text-green-600">Saved ✓</span>}
        {!canManage && <span className="text-xs text-[var(--muted)]">Only billing managers can change this.</span>}
      </div>
    </div>
  );
}
