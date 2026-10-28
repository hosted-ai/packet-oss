"use client";

/**
 * Admin "Ops Summary" tab — configure + verify the Daily Operating Summary that
 * posts to the ops Mattermost channel.
 *
 * Styling matches the admin house language (BusinessTab/ProductsTab): LITERAL hex
 * classes (#0b0f1c ink, #5b6476 muted, #e4e7ef line, #1a4fff blue), rounded-xl
 * cards. Never use var(--ink) (undefined in the admin app) or `[${var}]`
 * interpolation (Tailwind can't see it) — both render colorless.
 *
 * Product selection opens a modal of product CARDS (name, category, pricing,
 * assigned pools — same info as the Products tab) with multi-select. A metric
 * counts pods/nodes hard-linked to the selected products (by product ID).
 */

import { useEffect, useState } from "react";

interface GpuRow {
  label: string;
  source: "pool" | "baremetal";
  /** Pool rows: hard-linked GpuProduct IDs. */
  productIds: string[];
  /** Baremetal rows: hard-linked admin baremetal node ids (node assignment). */
  nodeIds?: number[];
  goal: number;
}
interface Goals {
  utilizationPct: number;
  activeCustomers: number;
  dailyRevenueCents: number;
  revPerGpuCents: number;
  runRateCents: number;
}
interface OpsScope {
  mode: "everything" | "products";
  productIds: string[];
}
interface Config {
  enabled: boolean;
  scope: OpsScope;
  gpuRows: GpuRow[];
  goals: Goals;
}
/** Normalized product for the picker cards. */
interface PickProduct {
  id: string;
  name: string;
  category?: string;
  billing?: "hourly" | "monthly";
  price?: string;
  pools?: string[];
  detail?: string; // bare-metal specs
  featured?: boolean;
}
/** A baremetal node + its region, for the node-assignment picker. */
interface BmNode {
  id: number;
  name: string;
  gpu_count: number;
  gpu_model: string;
  status: string; // "Online", …
  service_status: string; // "In service" | "Not in service"
}
interface BmNodeRegion {
  id: number;
  region_name: string;
  city: string;
  country: string;
  nodes: BmNode[];
}
type Status = { kind: "ok" | "err"; msg: string } | null;

const dollars = (cents: number) => Math.round(cents / 100);
const toCents = (d: string) => Math.round((parseFloat(d) || 0) * 100);

const CARD = "bg-white rounded-xl border border-[#e4e7ef] p-5";
const FIELD =
  "rounded-lg border border-[#e4e7ef] px-3 py-2 text-sm text-[#0b0f1c] bg-white " +
  "focus:border-[#1a4fff] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]/15";
const BTN_PRIMARY =
  "rounded-lg px-3.5 py-2 text-sm font-medium text-white bg-[#1a4fff] hover:bg-[#1238c9] disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg px-3.5 py-2 text-sm font-medium bg-white border border-[#e4e7ef] text-[#5b6476] hover:bg-gray-50 disabled:opacity-50";

// ── Product picker modal — product cards + multi-select ───────────────────────
function ProductPickerModal({
  source,
  products,
  selected,
  onConfirm,
  onClose,
}: {
  source: "pool" | "baremetal";
  products: PickProduct[];
  selected: string[];
  onConfirm: (productIds: string[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(selected.filter((id) => products.some((p) => p.id === id))),
  );

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const kindLabel = source === "baremetal" ? "bare-metal products" : "GPU products";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#e4e7ef] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e4e7ef] px-5 py-4">
          <div>
            <h3 className="font-semibold text-[#0b0f1c]">Choose {kindLabel}</h3>
            <p className="text-sm text-[#5b6476]">The metric counts pods/nodes from the selected products.</p>
          </div>
          <button className="text-[#5b6476] hover:text-[#0b0f1c]" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#f7f8fb]/40">
          {products.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#5b6476]">
              No {kindLabel} found in this environment.
            </div>
          ) : (
            products.map((p) => {
              const sel = checked.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    sel ? "border-[#1a4fff] bg-[#1a4fff]/5" : "border-[#e4e7ef] bg-white hover:bg-[#f7f8fb]/60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={sel} readOnly className="mt-1 accent-[#1a4fff]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[#0b0f1c]">{p.name}</span>
                        {p.featured && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Popular</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#5b6476]">
                        {p.category && <span className="rounded bg-[#f7f8fb] px-2 py-0.5">{p.category}</span>}
                        {p.billing && (
                          <span className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
                            p.billing === "monthly" ? "bg-indigo-100 text-indigo-700" : "bg-sky-100 text-sky-700"
                          }`}>
                            {p.billing}
                          </span>
                        )}
                        {p.price && <span className="font-mono text-[#0b0f1c]">{p.price}</span>}
                        {p.detail && <span className="font-mono">{p.detail}</span>}
                      </div>
                      {p.pools && p.pools.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.pools.slice(0, 3).map((pn, idx) => (
                            <span key={idx} className="rounded bg-[#f7f8fb] px-2 py-0.5 text-xs text-[#5b6476]">{pn}</span>
                          ))}
                          {p.pools.length > 3 && (
                            <span className="rounded bg-[#f7f8fb] px-2 py-0.5 text-xs text-[#5b6476]">+{p.pools.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#e4e7ef] px-5 py-3">
          <span className="text-sm text-[#5b6476]">
            {checked.size} product{checked.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex gap-2">
            <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
            <button className={BTN_PRIMARY} onClick={() => onConfirm([...checked])}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Node picker modal — baremetal nodes grouped by region, multi-select ───────
function NodePickerModal({
  regions,
  loading,
  selected,
  onConfirm,
  onClose,
}: {
  regions: BmNodeRegion[] | null;
  loading: boolean;
  selected: number[];
  onConfirm: (nodeIds: number[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(selected));
  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#e4e7ef] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e4e7ef] px-5 py-4">
          <div>
            <h3 className="font-semibold text-[#0b0f1c]">Assign bare-metal nodes</h3>
            <p className="text-sm text-[#5b6476]">The metric sums GPU cards over the in-service nodes you pick.</p>
          </div>
          <button className="text-[#5b6476] hover:text-[#0b0f1c]" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f7f8fb]/40">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-6 w-6 border-2 border-[#1a4fff] border-t-transparent rounded-full" />
            </div>
          ) : !regions || regions.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#5b6476]">
              No bare-metal regions/nodes found in this environment.
            </div>
          ) : (
            regions.map((region) => (
              <div key={region.id}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#5b6476]">
                  {region.region_name} · {region.city}, {region.country}
                </div>
                {region.nodes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#e4e7ef] px-3 py-2 text-xs text-[#9ca3af]">
                    No nodes in this region.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {region.nodes.map((n) => {
                      const sel = checked.has(n.id);
                      const inService = (n.service_status || "").toLowerCase() === "in service";
                      const online = (n.status || "").toLowerCase() === "online";
                      return (
                        <button
                          key={n.id}
                          onClick={() => toggle(n.id)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors ${
                            sel ? "border-[#1a4fff] bg-[#1a4fff]/5" : "border-[#e4e7ef] bg-white hover:bg-[#f7f8fb]/60"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input type="checkbox" checked={sel} readOnly className="mt-1 accent-[#1a4fff]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-[#0b0f1c]">{n.name}</span>
                                <span className="rounded bg-[#f7f8fb] px-2 py-0.5 text-xs font-mono text-[#0b0f1c]">
                                  {n.gpu_count} GPU{n.gpu_count === 1 ? "" : "s"}
                                </span>
                                {n.gpu_model && <span className="text-xs text-[#5b6476]">{n.gpu_model}</span>}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                <span className={`rounded px-1.5 py-0.5 font-semibold ${online ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                                  {n.status}
                                </span>
                                <span className={`rounded px-1.5 py-0.5 font-semibold ${inService ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                                  {n.service_status}
                                </span>
                                {!(online && inService) && (
                                  <span className="text-[#9ca3af]">counts only when Online + In service</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#e4e7ef] px-5 py-3">
          <span className="text-sm text-[#5b6476]">
            {checked.size} node{checked.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex gap-2">
            <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
            <button className={BTN_PRIMARY} onClick={() => onConfirm([...checked])}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OpsSummaryTab() {
  const [config, setConfig] = useState<Config | null>(null);
  const [webhookSet, setWebhookSet] = useState(false);
  const [webhookInput, setWebhookInput] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);
  const [poolProducts, setPoolProducts] = useState<PickProduct[]>([]);
  const [bmProducts, setBmProducts] = useState<PickProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pickerRow, setPickerRow] = useState<number | null>(null);
  const [scopePicker, setScopePicker] = useState(false);
  // Baremetal node assignment: nodes lazy-loaded from the admin panel on first open.
  const [nodePickerRow, setNodePickerRow] = useState<number | null>(null);
  const [bmNodeRegions, setBmNodeRegions] = useState<BmNodeRegion[] | null>(null);
  const [bmNodesLoading, setBmNodesLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/ops-summary").then((r) => r.json()),
      fetch("/api/admin/bare-metal-products").then((r) => r.json()).catch(() => ({ products: [] })),
      fetch("/api/admin/gpu-products").then((r) => r.json()).catch(() => ({ data: [], categories: [] })),
      fetch("/api/admin/pools").then((r) => r.json()).catch(() => ({ data: null })),
    ])
      .then(([cfg, bm, gpu, pl]) => {
        setConfig(cfg.config);
        setWebhookSet(cfg.webhookSet);
        setLastPosted(cfg.lastPosted ?? null);

        const catName = new Map<string, string>((gpu.categories ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
        const poolName = new Map<string, string>(
          ((pl.data?.pools ?? []) as Array<{ id: number | string; name: string }>).map((p) => [String(p.id), p.name]),
        );

        setBmProducts(
          (bm.products ?? [])
            .filter((p: { haiGpuType?: string }) => p.haiGpuType)
            .map((p: { id: string; label: string; gpuType?: string; haiGpuType: string; gpuCount?: number; ramGb?: number; storageGb?: number }) => ({
              id: p.id,
              name: p.label,
              category: p.gpuType,
              detail: [p.gpuCount ? `${p.gpuCount}× ${p.haiGpuType}` : p.haiGpuType, p.ramGb ? `${p.ramGb}GB RAM` : null, p.storageGb ? `${p.storageGb}GB` : null]
                .filter(Boolean)
                .join(" · "),
            })),
        );
        setPoolProducts(
          (gpu.data ?? [])
            .map((p: { id: string; name: string; featured?: boolean; billingType?: string; pricePerHourCents?: number; pricePerMonthCents?: number; categoryIds?: string[]; poolIds?: Array<number | string> }) => ({
              id: p.id,
              name: p.name,
              featured: p.featured,
              category: (p.categoryIds ?? []).map((id) => catName.get(id) ?? id).join(", ") || "Uncategorized",
              billing: p.billingType === "monthly" ? "monthly" : "hourly",
              price:
                p.billingType === "monthly" && p.pricePerMonthCents
                  ? `$${(p.pricePerMonthCents / 100).toFixed(2)}/mo`
                  : `$${((p.pricePerHourCents ?? 0) / 100).toFixed(2)}/hr`,
              pools: (p.poolIds ?? []).map((id) => poolName.get(String(id)) ?? `Pool ${id}`),
            })),
        );
      })
      .catch(() => setStatus({ kind: "err", msg: "Failed to load config" }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-[#1a4fff] border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!config) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">Could not load config.</div>;

  const patch = (next: Config) => {
    setConfig(next);
    setDirty(true);
  };
  const updateRow = (i: number, p: Partial<GpuRow>) =>
    patch({ ...config, gpuRows: config.gpuRows.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const addRow = () =>
    patch({ ...config, gpuRows: [...config.gpuRows, { label: "", source: "pool", productIds: [], goal: 0 }] });
  const removeRow = (i: number) => patch({ ...config, gpuRows: config.gpuRows.filter((_, j) => j !== i) });
  const setGoal = (p: Partial<Goals>) => patch({ ...config, goals: { ...config.goals, ...p } });
  const toggleEnabled = () => patch({ ...config, enabled: !config.enabled });

  const scope: OpsScope = config.scope ?? { mode: "everything", productIds: [] };
  const setScopeMode = (mode: "everything" | "products") =>
    patch({ ...config, scope: { mode, productIds: scope.productIds } });
  const removeScopeProduct = (id: string) =>
    patch({ ...config, scope: { ...scope, productIds: scope.productIds.filter((x) => x !== id) } });
  const confirmScopePicker = (ids: string[]) => {
    patch({ ...config, scope: { mode: "products", productIds: ids } });
    setScopePicker(false);
  };

  const productsFor = (source: "pool" | "baremetal") => (source === "baremetal" ? bmProducts : poolProducts);
  const productName = (source: "pool" | "baremetal", id: string) =>
    productsFor(source).find((p) => p.id === id)?.name ?? id;
  const removeProduct = (i: number, row: GpuRow, id: string) =>
    updateRow(i, { productIds: row.productIds.filter((x) => x !== id) });

  const confirmPicker = (productIds: string[]) => {
    if (pickerRow === null) return;
    const row = config.gpuRows[pickerRow];
    const firstName = productIds[0] ? productName(row.source, productIds[0]) : "";
    updateRow(pickerRow, {
      productIds,
      label: row.label.trim() ? row.label : firstName, // default to the first product's name; editable
    });
    setPickerRow(null);
  };

  // ── Baremetal node assignment ──
  const allBmNodes = (): BmNode[] => (bmNodeRegions ?? []).flatMap((r) => r.nodes);
  const nodeName = (id: number) => allBmNodes().find((n) => n.id === id)?.name ?? `Node ${id}`;
  const removeNode = (i: number, row: GpuRow, id: number) =>
    updateRow(i, { nodeIds: (row.nodeIds ?? []).filter((x) => x !== id) });
  const openNodePicker = async (i: number) => {
    setNodePickerRow(i);
    if (bmNodeRegions === null && !bmNodesLoading) {
      setBmNodesLoading(true);
      try {
        const r = await fetch("/api/admin/baremetal-nodes");
        const d = await r.json();
        setBmNodeRegions(Array.isArray(d.regions) ? d.regions : []);
      } catch {
        setBmNodeRegions([]);
      } finally {
        setBmNodesLoading(false);
      }
    }
  };
  const confirmNodePicker = (nodeIds: number[]) => {
    if (nodePickerRow === null) return;
    const row = config.gpuRows[nodePickerRow];
    const firstName = nodeIds[0] ? nodeName(nodeIds[0]) : "";
    updateRow(nodePickerRow, {
      nodeIds,
      label: row.label.trim() ? row.label : firstName, // mirror the product picker's label default
    });
    setNodePickerRow(null);
  };

  async function save() {
    setBusy("save");
    setStatus(null);
    try {
      const body: { config: Config; webhookUrl?: string } = { config: config! };
      if (webhookInput.trim()) body.webhookUrl = webhookInput.trim();
      const r = await fetch("/api/admin/ops-summary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed");
      setWebhookSet(d.webhookSet);
      setReplacing(false);
      setWebhookInput("");
      setDirty(false);
      setStatus({ kind: "ok", msg: "Saved" });
    } catch (e) {
      setStatus({ kind: "err", msg: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(null);
    }
  }

  async function action(act: "preview" | "test" | "send") {
    if (act === "send" && !window.confirm("This posts the REAL summary to the channel now. Continue?")) return;
    setBusy(act);
    setStatus(null);
    if (act === "preview") setPreview(null);
    try {
      const r = await fetch("/api/admin/ops-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act }),
      });
      const d = await r.json();
      if (act === "preview") {
        if (!d.ok) throw new Error(d.error || "Preview failed");
        setPreview(d.text);
      } else {
        if (!d.ok) throw new Error(d.error || `${act} failed`);
        setStatus({ kind: "ok", msg: d.message || "Done" });
        if (act === "send") setLastPosted(new Date().toISOString().split("T")[0]);
      }
    } catch (e) {
      setStatus({ kind: "err", msg: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(null);
    }
  }

  const verifyDisabled = !!busy || dirty;

  const goalRow = (label: string, node: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-[#5b6476]">{label}</span>
      {node}
    </div>
  );
  const adorned = (prefix: string | null, suffix: string | null, value: number, onChange: (v: string) => void) => (
    <div className="flex items-center rounded-lg border border-[#e4e7ef] bg-white px-2 focus-within:border-[#1a4fff] focus-within:ring-2 focus-within:ring-[#1a4fff]/15">
      {prefix && <span className="text-sm text-[#5b6476]">{prefix}</span>}
      <input
        type="number"
        className="w-24 px-1.5 py-1.5 text-sm text-right text-[#0b0f1c] bg-transparent outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span className="text-sm text-[#5b6476]">{suffix}</span>}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0b0f1c]">Daily Ops Summary</h2>
          <p className="text-sm text-[#5b6476] mt-1">
            {webhookSet ? "Configured" : "Not configured"} · posts daily 6:00 AM IST (00:30 UTC) ·{" "}
            {lastPosted ? `last posted ${lastPosted}` : "never posted"}
          </p>
        </div>
        <button
          onClick={toggleEnabled}
          role="switch"
          aria-checked={config.enabled}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
            config.enabled
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-zinc-100 text-zinc-500 border-zinc-200"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${config.enabled ? "bg-emerald-500" : "bg-zinc-400"}`} />
          Auto-post {config.enabled ? "on" : "off"}
        </button>
      </div>

      {/* Webhook */}
      <section className={CARD}>
        <h3 className="font-semibold text-[#0b0f1c]">Mattermost webhook</h3>
        <p className="text-sm text-[#5b6476] mt-1 mb-3">The incoming-webhook URL for the ops channel. Stored encrypted.</p>
        {webhookSet && !replacing ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-mono text-[#5b6476]">••••••••••••••••  (set)</span>
            <button className="text-[#1a4fff] hover:underline" onClick={() => setReplacing(true)}>Replace</button>
          </div>
        ) : (
          <input
            type="url"
            placeholder="https://mattermost.example.com/hooks/…"
            className={`${FIELD} w-full font-mono`}
            value={webhookInput}
            onChange={(e) => {
              setWebhookInput(e.target.value);
              setDirty(true);
            }}
          />
        )}
      </section>

      {/* Scope */}
      <section className={CARD}>
        <h3 className="font-semibold text-[#0b0f1c]">Scope</h3>
        <p className="text-sm text-[#5b6476] mt-1 mb-3">
          The business metrics (utilization, customers, revenue, run rate) cover either the whole platform or only the selected products&apos; pools.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={FIELD}
            value={scope.mode}
            onChange={(e) => setScopeMode(e.target.value as "everything" | "products")}
          >
            <option value="everything">Whole platform</option>
            <option value="products">Specific products</option>
          </select>
          {scope.mode === "products" && (
            <>
              {scope.productIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#1a4fff]/10 text-[#1a4fff] px-2.5 py-0.5 text-xs font-medium">
                  {productName("pool", id)}
                  <button className="hover:text-rose-600" onClick={() => removeScopeProduct(id)} aria-label={`Remove ${productName("pool", id)}`}>×</button>
                </span>
              ))}
              <button
                className="rounded-lg border border-[#e4e7ef] bg-white px-2.5 py-1 text-xs font-medium text-[#1a4fff] hover:bg-gray-50"
                onClick={() => setScopePicker(true)}
              >
                Choose products
              </button>
              {scope.productIds.length === 0 && <span className="text-xs text-amber-600">pick at least one, or switch to whole platform</span>}
            </>
          )}
        </div>
      </section>

      {/* GPU metrics */}
      <section className={CARD}>
        <h3 className="font-semibold text-[#0b0f1c]">GPU metrics</h3>
        <p className="text-sm text-[#5b6476] mt-1 mb-3">
          Each row counts pods/nodes matching <span className="font-medium">any</span> chosen product.
        </p>
        <div className="space-y-3">
          {config.gpuRows.map((row, i) => (
            <div key={i} className="rounded-lg border border-[#e4e7ef] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${FIELD} flex-1 min-w-40`}
                  placeholder="Metric label (e.g. B200 Dedicated)"
                  value={row.label}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                />
                <select
                  className={FIELD}
                  value={row.source}
                  onChange={(e) => updateRow(i, { source: e.target.value as "pool" | "baremetal", productIds: [], nodeIds: [] })}
                >
                  <option value="pool">GPUaaS</option>
                  <option value="baremetal">Bare metal</option>
                </select>
                <div className="flex items-center gap-1.5 text-sm text-[#5b6476]">
                  goal
                  <input
                    type="number"
                    className={`${FIELD} w-20`}
                    value={row.goal}
                    onChange={(e) => updateRow(i, { goal: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
                <button className="ml-auto text-sm text-rose-600 hover:text-rose-700 hover:underline" onClick={() => removeRow(i)}>
                  Remove
                </button>
              </div>
              {row.source === "baremetal" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[#5b6476] mr-0.5">Counts in-service nodes:</span>
                  {(row.nodeIds ?? []).map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#1a4fff]/10 text-[#1a4fff] px-2.5 py-0.5 text-xs font-medium">
                      {nodeName(id)}
                      <button className="hover:text-rose-600" onClick={() => removeNode(i, row, id)} aria-label={`Remove ${nodeName(id)}`}>×</button>
                    </span>
                  ))}
                  <button
                    className="rounded-lg border border-[#e4e7ef] bg-white px-2.5 py-1 text-xs font-medium text-[#1a4fff] hover:bg-gray-50"
                    onClick={() => openNodePicker(i)}
                  >
                    Assign nodes
                  </button>
                  {(row.nodeIds ?? []).length === 0 && <span className="text-xs text-amber-600">assign at least one</span>}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[#5b6476] mr-0.5">Counts:</span>
                  {row.productIds.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#1a4fff]/10 text-[#1a4fff] px-2.5 py-0.5 text-xs font-medium">
                      {productName(row.source, id)}
                      <button className="hover:text-rose-600" onClick={() => removeProduct(i, row, id)} aria-label={`Remove ${productName(row.source, id)}`}>×</button>
                    </span>
                  ))}
                  <button
                    className="rounded-lg border border-[#e4e7ef] bg-white px-2.5 py-1 text-xs font-medium text-[#1a4fff] hover:bg-gray-50"
                    onClick={() => setPickerRow(i)}
                  >
                    Choose products
                  </button>
                  {row.productIds.length === 0 && <span className="text-xs text-amber-600">pick at least one</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="mt-3 text-sm font-medium text-[#1a4fff] hover:underline" onClick={addRow}>+ Add metric</button>
      </section>

      {/* Goals */}
      <section className={CARD}>
        <h3 className="font-semibold text-[#0b0f1c]">Goals</h3>
        <p className="text-sm text-[#5b6476] mt-1 mb-2">Targets shown in the right-hand column of the post.</p>
        <div className="grid sm:grid-cols-2 gap-x-8">
          {goalRow("Utilization %", adorned(null, "%", config.goals.utilizationPct, (v) => setGoal({ utilizationPct: parseInt(v, 10) || 0 })))}
          {goalRow("Active Customers", adorned(null, null, config.goals.activeCustomers, (v) => setGoal({ activeCustomers: parseInt(v, 10) || 0 })))}
          {goalRow("Daily Revenue", adorned("$", null, dollars(config.goals.dailyRevenueCents), (v) => setGoal({ dailyRevenueCents: toCents(v) })))}
          {goalRow("Revenue / GPU / Day", adorned("$", null, dollars(config.goals.revPerGpuCents), (v) => setGoal({ revPerGpuCents: toCents(v) })))}
          {goalRow("Revenue Run Rate", adorned("$", null, dollars(config.goals.runRateCents), (v) => setGoal({ runRateCents: toCents(v) })))}
        </div>
      </section>

      {/* Verify */}
      <section className={CARD}>
        <h3 className="font-semibold text-[#0b0f1c]">Verify</h3>
        <p className="text-sm text-[#5b6476] mt-1 mb-3">Preview renders inline (no post). Test pings the webhook. Send posts the real summary now.</p>
        <div className="flex flex-wrap gap-2">
          <button className={BTN_GHOST} disabled={verifyDisabled} onClick={() => action("preview")}>
            {busy === "preview" ? "Rendering…" : "Preview"}
          </button>
          <button className={BTN_GHOST} disabled={verifyDisabled || !webhookSet} onClick={() => action("test")}>
            {busy === "test" ? "Testing…" : "Test webhook"}
          </button>
          <button className={BTN_PRIMARY} disabled={verifyDisabled || !webhookSet} onClick={() => action("send")}>
            {busy === "send" ? "Sending…" : "Send now"}
          </button>
        </div>
        {dirty && <p className="text-xs text-amber-600 mt-2">Save your changes — Preview/Send use the saved config.</p>}
        {preview && (
          <pre className="mt-3 bg-gray-50 border border-[#e4e7ef] rounded-lg p-3 text-xs whitespace-pre-wrap overflow-x-auto text-[#0b0f1c]">
            {preview}
          </pre>
        )}
      </section>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-[#e4e7ef] bg-white/95 backdrop-blur px-1 py-3">
        <button className={BTN_PRIMARY} disabled={!!busy || !dirty} onClick={save}>
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-amber-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
          </span>
        ) : status ? (
          <span className={`text-sm ${status.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{status.msg}</span>
        ) : (
          <span className="text-sm text-[#5b6476]">All changes saved</span>
        )}
      </div>

      {pickerRow !== null && (
        <ProductPickerModal
          source={config.gpuRows[pickerRow].source}
          products={config.gpuRows[pickerRow].source === "baremetal" ? bmProducts : poolProducts}
          selected={config.gpuRows[pickerRow].productIds}
          onConfirm={confirmPicker}
          onClose={() => setPickerRow(null)}
        />
      )}

      {scopePicker && (
        <ProductPickerModal
          source="pool"
          products={poolProducts}
          selected={scope.productIds}
          onConfirm={confirmScopePicker}
          onClose={() => setScopePicker(false)}
        />
      )}

      {nodePickerRow !== null && (
        <NodePickerModal
          regions={bmNodeRegions}
          loading={bmNodesLoading}
          selected={config.gpuRows[nodePickerRow].nodeIds ?? []}
          onConfirm={confirmNodePicker}
          onClose={() => setNodePickerRow(null)}
        />
      )}
    </div>
  );
}
