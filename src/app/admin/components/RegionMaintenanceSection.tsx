"use client";

/**
 * Admin: put a HAI region into maintenance. While a region is in maintenance,
 * new provisions into it are blocked (customer + admin + cron) and existing
 * instance cards there hide actions + show a banner. Display-only — running
 * pods keep running. Enabling asks for confirmation; lifting is instant.
 */

import { useState, useEffect, useCallback } from "react";

interface HAIRegion {
  id: number;
  region_name: string;
  city?: string;
  country?: string;
}
interface MaintenanceRow {
  regionId: number;
  regionName: string | null;
  message: string | null;
  enabledBy: string;
  enabledAt: string;
}
interface ApiData {
  regions: HAIRegion[];
  maintenance: MaintenanceRow[];
  parkedOrderCounts: Record<number, number>;
}

const regionLabel = (r: HAIRegion) =>
  `${r.region_name}${r.city ? ` (${r.city})` : ""}${r.country ? `, ${r.country}` : ""}`;

export function RegionMaintenanceSection() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // add form
  const [selectedRegion, setSelectedRegion] = useState<number | "">("");
  const [message, setMessage] = useState("");
  // confirm-on-enable
  const [pending, setPending] = useState<{ regionId: number; label: string; parked: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/region-maintenance");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const inMaintenance = new Set((data?.maintenance ?? []).map((m) => m.regionId));
  const available = (data?.regions ?? []).filter((r) => !inMaintenance.has(r.id));

  function askConfirm() {
    if (!selectedRegion || !data) return;
    const r = data.regions.find((x) => x.id === selectedRegion);
    setPending({
      regionId: Number(selectedRegion),
      label: r ? regionLabel(r) : `region ${selectedRegion}`,
      parked: data.parkedOrderCounts[Number(selectedRegion)] ?? 0,
    });
  }

  async function confirmEnable() {
    if (!pending) return;
    setBusy(true);
    try {
      const r = data?.regions.find((x) => x.id === pending.regionId);
      const res = await fetch("/api/admin/region-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regionId: pending.regionId,
          regionName: r ? regionLabel(r) : undefined,
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPending(null);
      setSelectedRegion("");
      setMessage("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable");
    } finally {
      setBusy(false);
    }
  }

  async function lift(regionId: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/region-maintenance?regionId=${regionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to lift");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-1 text-[#0b0f1c]">Region Maintenance</h3>
      <p className="text-sm text-[#5b6476] mb-5">
        Put a region into maintenance to block new GPU and bare-metal provisions there and
        show customers a banner on their instances. Running instances keep running — this
        only pauses actions and new deployments.
      </p>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-10 bg-[#f1f3f9] rounded animate-pulse" />
          <div className="h-10 bg-[#f1f3f9] rounded animate-pulse w-2/3" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-rose-600">Couldn&apos;t load regions — {error}</span>
          <button onClick={load} className="text-[#1a4fff] hover:underline font-medium">
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Active maintenance rows (pinned, amber) */}
          {data && data.maintenance.length > 0 ? (
            <ul className="space-y-2 mb-5">
              {data.maintenance.map((m) => {
                const parked = data.parkedOrderCounts[m.regionId] ?? 0;
                return (
                  <li
                    key={m.regionId}
                    className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-amber-900">
                        {m.regionName || `Region ${m.regionId}`}
                      </div>
                      <div className="text-xs text-amber-700 mt-0.5">
                        {m.message || "Default banner message"}
                      </div>
                      <div className="text-xs text-amber-600 mt-1">
                        by {m.enabledBy}
                        {parked > 0 && (
                          <> · <strong>{parked}</strong> bare-metal order{parked === 1 ? "" : "s"} parked</>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => lift(m.regionId)}
                      disabled={busy}
                      className="shrink-0 text-sm text-[#1a4fff] hover:underline font-medium disabled:opacity-50"
                    >
                      Lift
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[#5b6476] mb-5">
              No regions in maintenance. Select one below to block new provisions and notify
              affected customers.
            </p>
          )}

          {/* Confirm-on-enable */}
          {pending ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-900">
                Put <strong>{pending.label}</strong> into maintenance? This blocks all new
                provisions there and shows every customer with an instance in that region a
                maintenance banner.
                {pending.parked > 0 && (
                  <> {pending.parked} paid bare-metal order{pending.parked === 1 ? "" : "s"} will wait until you lift it.</>
                )}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={confirmEnable}
                  disabled={busy}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  {busy ? "Enabling…" : "Confirm — put in maintenance"}
                </button>
                <button
                  onClick={() => setPending(null)}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm text-[#5b6476] hover:text-[#0b0f1c]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Region</label>
                  <select
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value ? Number(e.target.value) : "")}
                    className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  >
                    <option value="">Select a region…</option>
                    {available.map((r) => (
                      <option key={r.id} value={r.id}>
                        {regionLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Customer message <span className="text-[#5b6476] font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={2000}
                    placeholder="This region is under maintenance. Controls are paused — your server and data are safe."
                    className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#9aa3b2] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
              </div>
              <button
                onClick={askConfirm}
                disabled={!selectedRegion || busy}
                className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1540d6] text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Put in maintenance
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
