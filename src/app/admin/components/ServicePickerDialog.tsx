"use client";

import { useState, useEffect, useRef } from "react";

interface HAIService {
  id: string;
  name: string;
  description: string;
  serviceType: string;
  isEnabled: boolean;
  isSystemDefined: boolean;
  recipeId: number | null;
  recipeExecTimingType: string | null;
  instancesCount: number;
}

interface ServicePickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (serviceId: string, serviceName: string) => void;
  currentServiceId?: string | null;
}

export function ServicePickerDialog({ open, onClose, onSelect, currentServiceId }: ServicePickerDialogProps) {
  const [services, setServices] = useState<HAIService[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const fetchServices = async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ per_page: "50" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/admin/hai-services?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setServices(data.services || []);
    } catch {
      setError("Failed to load services from HAI");
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchServices("");
    }
  }, [open]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchServices(value), 300);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold text-zinc-900">Select HAI Service</h2>
          <p className="text-sm text-zinc-500 mt-1">Choose a service from the HAI admin panel to link</p>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-zinc-100">
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search services by name..."
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            autoFocus
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading && (
            <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
              Loading services...
            </div>
          )}

          {error && (
            <div className="py-4 text-center text-sm text-rose-600">{error}</div>
          )}

          {!loading && !error && services.length === 0 && (
            <div className="py-12 text-center text-sm text-zinc-500">
              {search ? "No services match your search" : "No services found in HAI"}
            </div>
          )}

          {!loading && services.map(svc => (
            <button
              key={svc.id}
              onClick={() => onSelect(svc.id, svc.name)}
              className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                currentServiceId === svc.id
                  ? "bg-teal-50 border border-teal-200"
                  : "hover:bg-zinc-50 border border-transparent"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-zinc-900">{svc.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      svc.isEnabled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-100 text-zinc-500"
                    }`}>
                      {svc.isEnabled ? "Enabled" : "Disabled"}
                    </span>
                    {svc.recipeId && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        Recipe #{svc.recipeId}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
                    <span>{svc.serviceType}</span>
                    {svc.instancesCount > 0 && (
                      <span>{svc.instancesCount} instance{svc.instancesCount !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  {svc.description && (
                    <p className="text-xs text-zinc-400 mt-1 truncate">{svc.description}</p>
                  )}
                </div>
                <div className="ml-3 flex-shrink-0">
                  {currentServiceId === svc.id ? (
                    <span className="text-xs text-teal-600 font-medium">Selected</span>
                  ) : (
                    <span className="text-xs font-mono text-zinc-400 max-w-[80px] truncate block">{svc.id.slice(0, 8)}...</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 flex items-center justify-between">
          <span className="text-xs text-zinc-400">{services.length} service{services.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onSelect("", ""); }}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 rounded-lg"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
