"use client";

// Packet Health Metrics (PA-693) — platform metrics #1–12 from
// /api/admin/packet-health, shown at every period grain (the Daily Ops summary
// shows the same numbers at the 1-day grain). Cards follow the metrics
// dictionary order; the notes strip carries the honesty labels (proxy bases,
// series-start fallbacks, live-snapshot metrics).

import { useState, useEffect, useCallback } from "react";

interface TimeToFirstJob {
  medianHours: number | null;
  n: number;
  cohortSize: number;
  workloadBasisN: number;
  deployProxyN: number;
}

interface ActivePayingSplit {
  total: number;
  onDemandByGpuType: Record<string, number>;
  monthlyByGpuType: Record<string, number>;
}

interface ActivePaying {
  total: number;
  onDemand: number;
  monthly: number;
  dedicated: ActivePayingSplit;
  dynamic: ActivePayingSplit;
  unknownPool: number;
}

interface Mrr {
  totalCents: number;
  dailyProratedCents: number;
  dedicatedMonthlyByGpuType: Record<string, number>;
  dynamicMonthlyByGpuType: Record<string, number>;
  unknownPoolCents: number;
  stripeLiveCents: number | null;
  stripeDeltaCents: number | null;
}

interface Consumption {
  trailing30dCents: number;
  runRateCents: number;
  byGrain: { "1d": number; "7d": number; "1m": number };
  dedicatedByGpuType: Record<string, number>;
  dynamicByGpuType: Record<string, number>;
  unknownPoolCents: number;
}

interface Revenue {
  totalCents: number;
  subscriptionCents: number;
  consumptionCents: number;
  refundCents: number;
}

interface GpuCountBlock {
  physical: number;
  vgpuSlots: number;
}

interface ActiveGpus {
  total: GpuCountBlock;
  dedicated: GpuCountBlock;
  dynamic: GpuCountBlock;
  byModel: Record<string, GpuCountBlock>;
}

interface AvailableGpuHours {
  physicalGpuHours: number;
  vgpuSlotHours: number;
  basis: string;
  snapshotDays: number;
  windowDays: number;
}

interface Utilization {
  billedGpuHours: number;
  committedMonthlyGpuHours: number;
  rentedGpuHours: number;
  availableVgpuSlotHours: number;
  pct: number;
  capacityBasis: string;
  snapshotDays: number;
  windowDays: number;
}

interface HealthData {
  success: boolean;
  period: string;
  window: { start: string; end: string };
  asOf: string;
  metrics: {
    signups: number | null;
    timeToFirstJob: TimeToFirstJob | null;
    activePaying: ActivePaying | null;
    mrr: Mrr | null;
    consumption: Consumption | null;
    revenue: Revenue | null;
    suppliers: number | null;
    activeGpus: ActiveGpus | null;
    availableGpuHours: AvailableGpuHours | null;
    utilization: Utilization | null;
  };
  reconciliation: {
    stripeWindowPayers: number | null;
    stripeGrossVolumeCents: number | null;
    stripeLiveMrrCents: number | null;
  };
  notes: string[];
  cachedAt: string;
}

type PeriodChoice = "1d" | "7d" | "1m" | "custom";

const PERIOD_LABELS: Record<PeriodChoice, string> = {
  "1d": "1 Day",
  "7d": "7 Days",
  "1m": "30 Days",
  custom: "Custom",
};

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const num = (n: number) => n.toLocaleString("en-US");

function Card({
  title,
  value,
  sub,
  children,
}: {
  title: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-[#e4e7ef] p-4">
      <div className="text-sm text-[#5b6476] mb-2">{title}</div>
      <p className="text-2xl font-bold text-[#0b0f1c]">{value}</p>
      {sub && <p className="text-xs text-[#5b6476] mt-1">{sub}</p>}
      {children}
    </div>
  );
}

/** Small key→value breakdown table (GPU-type or model rows). */
function Breakdown({
  title,
  rows,
  fmt,
}: {
  title: string;
  rows: Record<string, number>;
  fmt: (v: number) => string;
}) {
  const entries = Object.entries(rows);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-[#5b6476]">{title}</div>
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs text-[#0b0f1c]">
          <span>{k}</span>
          <span>{fmt(v)}</span>
        </div>
      ))}
    </div>
  );
}

export function PacketHealthTab() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodChoice>("1d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const customReady = period !== "custom" || (customFrom !== "" && customTo !== "");

  const fetchMetrics = useCallback(
    async (refresh = false) => {
      if (!customReady) return; // wait for both dates before fetching
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period });
        if (period === "custom") {
          params.set("from", customFrom);
          params.set("to", customTo);
        }
        if (refresh) params.set("refresh", "true");
        const res = await fetch(`/api/admin/packet-health?${params}`);
        const body = await res.json();
        if (body.success) setData(body);
        else setError(body.error || "Failed to load platform metrics");
      } catch {
        setError("Failed to fetch platform metrics");
      } finally {
        setLoading(false);
      }
    },
    [period, customFrom, customTo, customReady],
  );

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const m = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-[#0b0f1c]">Packet Health Metrics</h2>
        <div className="flex gap-2 items-center flex-wrap">
          {(Object.keys(PERIOD_LABELS) as PeriodChoice[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                period === p
                  ? "bg-[#1a4fff] text-white"
                  : "bg-white border border-[#e4e7ef] text-[#5b6476] hover:bg-gray-50"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
          {period === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1.5 text-sm border border-[#e4e7ef] rounded-lg text-[#0b0f1c]"
                aria-label="From date"
              />
              <span className="text-sm text-[#5b6476]">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1.5 text-sm border border-[#e4e7ef] rounded-lg text-[#0b0f1c]"
                aria-label="To date"
              />
            </>
          )}
          <button
            onClick={() => fetchMetrics(true)}
            className="px-3 py-1.5 text-sm bg-white border border-[#e4e7ef] text-[#5b6476] hover:bg-gray-50 rounded-lg"
          >
            Refresh
          </button>
          {data?.cachedAt && (
            <span className="text-xs text-[#5b6476] self-center">
              Updated {new Date(data.cachedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {!customReady && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          Pick both dates to load a custom range.
        </div>
      )}

      {loading && customReady && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-[#1a4fff] border-t-transparent rounded-full"></div>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
          <button onClick={() => fetchMetrics()} className="ml-4 text-sm underline">
            Retry
          </button>
        </div>
      )}

      {data && m && !loading && !error && (
        <>
          <p className="text-xs text-[#5b6476]">
            Window: {data.window.start.slice(0, 10)} → {data.window.end.slice(0, 10)} (UTC) ·
            point-in-time metrics as of {new Date(data.asOf).toLocaleString()}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* #1 */}
            <Card
              title="1 · Signups (completed)"
              value={m.signups === null ? "—" : num(m.signups)}
              sub="account created + magic link clicked, internal excluded"
            />

            {/* #2 */}
            <Card
              title="2 · Time to First Job (median)"
              value={
                m.timeToFirstJob?.medianHours == null
                  ? "—"
                  : `${m.timeToFirstJob.medianHours.toLocaleString("en-US")} h`
              }
              sub={
                m.timeToFirstJob
                  ? `${m.timeToFirstJob.n}/${m.timeToFirstJob.cohortSize} of cohort activated · ${m.timeToFirstJob.workloadBasisN} workload / ${m.timeToFirstJob.deployProxyN} deploy-proxy`
                  : undefined
              }
            />

            {/* #3 */}
            <Card
              title="3 · Active Paying Customers"
              value={m.activePaying === null ? "—" : num(m.activePaying.total)}
              sub={
                m.activePaying
                  ? `${num(m.activePaying.onDemand)} on-demand · ${num(m.activePaying.monthly)} monthly · ${num(m.activePaying.unknownPool)} unclassified pool`
                  : undefined
              }
            />

            {/* #4 */}
            <Card
              title="4 · Active Paying — Dedicated"
              value={m.activePaying === null ? "—" : num(m.activePaying.dedicated.total)}
            >
              {m.activePaying && (
                <>
                  <Breakdown title="On-demand by GPU type" rows={m.activePaying.dedicated.onDemandByGpuType} fmt={num} />
                  <Breakdown title="Monthly by GPU type" rows={m.activePaying.dedicated.monthlyByGpuType} fmt={num} />
                </>
              )}
            </Card>

            {/* #5 */}
            <Card
              title="5 · Active Paying — Dynamic"
              value={m.activePaying === null ? "—" : num(m.activePaying.dynamic.total)}
            >
              {m.activePaying && (
                <>
                  <Breakdown title="On-demand by GPU type" rows={m.activePaying.dynamic.onDemandByGpuType} fmt={num} />
                  <Breakdown title="Monthly by GPU type" rows={m.activePaying.dynamic.monthlyByGpuType} fmt={num} />
                </>
              )}
            </Card>

            {/* #6 */}
            <Card
              title="6 · MRR (as of window end)"
              value={m.mrr === null ? "—" : usd(m.mrr.totalCents)}
              sub={
                m.mrr
                  ? `${usd(m.mrr.dailyProratedCents)}/day (÷30)${
                      m.mrr.stripeDeltaCents !== null
                        ? ` · Δ vs live Stripe ${usd(m.mrr.stripeDeltaCents)}`
                        : ""
                    }`
                  : undefined
              }
            >
              {m.mrr && (
                <>
                  <Breakdown title="Dedicated monthly by GPU type" rows={m.mrr.dedicatedMonthlyByGpuType} fmt={usd} />
                  <Breakdown title="Dynamic monthly by GPU type" rows={m.mrr.dynamicMonthlyByGpuType} fmt={usd} />
                </>
              )}
            </Card>

            {/* #7 */}
            <Card
              title="7 · Consumption Run-Rate (30d × 12, as of today)"
              value={m.consumption === null ? "—" : usd(m.consumption.runRateCents)}
              sub={
                m.consumption
                  ? `trailing 30d ${usd(m.consumption.trailing30dCents)} · 1d ${usd(m.consumption.byGrain["1d"])} · 7d ${usd(m.consumption.byGrain["7d"])} — always current, does not follow the selected period`
                  : undefined
              }
            >
              {m.consumption && (
                <>
                  <Breakdown title="Dedicated by GPU type (30d)" rows={m.consumption.dedicatedByGpuType} fmt={usd} />
                  <Breakdown title="Dynamic by GPU type (30d)" rows={m.consumption.dynamicByGpuType} fmt={usd} />
                </>
              )}
            </Card>

            {/* #8 */}
            <Card
              title="8 · Revenue (total)"
              value={m.revenue === null ? "—" : usd(m.revenue.totalCents)}
              sub={
                m.revenue
                  ? `subs ${usd(m.revenue.subscriptionCents)} + usage ${usd(m.revenue.consumptionCents)} − refunds ${usd(m.revenue.refundCents)}`
                  : undefined
              }
            />

            {/* #9 */}
            <Card
              title="9 · Suppliers (live GPUs)"
              value={m.suppliers === null ? "—" : num(m.suppliers)}
              sub="registered suppliers with ≥1 GPU on an online node (live)"
            />

            {/* #10 */}
            <Card
              title="10 · Active GPUs"
              value={m.activeGpus === null ? "—" : num(m.activeGpus.total.physical)}
              sub={
                m.activeGpus
                  ? `${num(m.activeGpus.total.vgpuSlots)} vGPU slots · dedicated ${num(m.activeGpus.dedicated.physical)} / dynamic ${num(m.activeGpus.dynamic.physical)} (live)`
                  : undefined
              }
            >
              {m.activeGpus && Object.keys(m.activeGpus.byModel).length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-[#5b6476]">
                    By model (physical / vGPU slots)
                  </div>
                  {Object.entries(m.activeGpus.byModel).map(([model, block]) => (
                    <div key={model} className="flex justify-between text-xs text-[#0b0f1c]">
                      <span>{model}</span>
                      <span>
                        {num(block.physical)} / {num(block.vgpuSlots)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* #11 */}
            <Card
              title="11 · Available GPU-hours"
              value={m.availableGpuHours === null ? "—" : num(Math.round(m.availableGpuHours.vgpuSlotHours))}
              sub={
                m.availableGpuHours
                  ? `vGPU-slot-hours · ${num(Math.round(m.availableGpuHours.physicalGpuHours))} physical · basis: ${m.availableGpuHours.basis} (${m.availableGpuHours.snapshotDays}/${m.availableGpuHours.windowDays} snapshot days)`
                  : undefined
              }
            />

            {/* #12 */}
            <Card
              title="12 · Utilization"
              value={m.utilization === null ? "—" : `${m.utilization.pct}%`}
              sub={
                m.utilization
                  ? `${num(Math.round(m.utilization.rentedGpuHours))} rented (${num(Math.round(m.utilization.billedGpuHours))} billed + ${num(Math.round(m.utilization.committedMonthlyGpuHours))} committed) ÷ ${num(Math.round(m.utilization.availableVgpuSlotHours))} available · basis: ${m.utilization.capacityBasis}`
                  : undefined
              }
            />
          </div>

          {/* Stripe reconciliation */}
          <div className="bg-white rounded-xl border border-[#e4e7ef] p-4">
            <div className="text-sm font-medium text-[#0b0f1c] mb-2">Stripe reconciliation</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-[#5b6476]">
              <div>
                Window payers (charges):{" "}
                <span className="text-[#0b0f1c] font-medium">
                  {data.reconciliation.stripeWindowPayers ?? "—"}
                </span>
              </div>
              <div>
                Gross volume:{" "}
                <span className="text-[#0b0f1c] font-medium">
                  {data.reconciliation.stripeGrossVolumeCents === null
                    ? "—"
                    : usd(data.reconciliation.stripeGrossVolumeCents)}
                </span>
              </div>
              <div>
                Live MRR:{" "}
                <span className="text-[#0b0f1c] font-medium">
                  {data.reconciliation.stripeLiveMrrCents === null
                    ? "—"
                    : usd(data.reconciliation.stripeLiveMrrCents)}
                </span>
              </div>
            </div>
            <p className="text-xs text-[#5b6476] mt-2">
              Deposits ≠ revenue: on-demand customers pay by wallet consumption, so window payers
              and gross volume differ from #3/#8 by design. See docs/platform-metrics.md.
            </p>
          </div>

          {/* Notes / honesty labels */}
          {data.notes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="text-sm font-medium text-amber-900 mb-1">Notes</div>
              <ul className="list-disc pl-5 text-xs text-amber-800 space-y-1">
                {data.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
