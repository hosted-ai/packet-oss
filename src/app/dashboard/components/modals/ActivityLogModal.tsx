/**
 * Activity Log Modal Component
 *
 * Modal displaying activity events with download option.
 *
 * @module dashboard/modals/ActivityLogModal
 */

"use client";

interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  created: number;
}

interface ActivityLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: ActivityEvent[];
  formatDateTime: (timestamp: number) => string;
  onDownloadCSV: () => void;
}

export function ActivityLogModal({
  isOpen,
  onClose,
  events,
  formatDateTime,
  onDownloadCSV,
}: ActivityLogModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl mx-4 shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ink)]">Activity Log</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={onDownloadCSV}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
            >
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="text-sm text-zinc-500 mb-4">
          {events.length} event{events.length !== 1 ? 's' : ''} total
        </div>

        <div className="flex-1 overflow-y-auto border border-[var(--line)] rounded-xl">
          {events.length > 0 ? (
            <table className="w-full">
              <thead className="bg-zinc-50 sticky top-0">
                <tr>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Date & Time</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Type</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 text-sm text-zinc-600 whitespace-nowrap">
                      {formatDateTime(event.created)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                        event.type === "gpu_launched" ? "bg-zinc-50 text-zinc-700" :
                        event.type === "gpu_terminated" ? "bg-zinc-100 text-zinc-700" :
                        event.type === "gpu_scaled" ? "bg-zinc-50 text-[var(--ink)]" :
                        event.type === "gpu_restarted" ? "bg-zinc-50 text-[var(--ink)]" :
                        event.type === "payment_received" ? "bg-zinc-50 text-zinc-700" :
                        event.type === "wallet_charged" ? "bg-orange-100 text-orange-700" :
                        "bg-zinc-100 text-zinc-600"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          event.type === "gpu_launched" ? "bg-zinc-50" :
                          event.type === "gpu_terminated" ? "bg-zinc-400" :
                          event.type === "gpu_scaled" ? "bg-zinc-50" :
                          event.type === "gpu_restarted" ? "bg-zinc-50" :
                          event.type === "payment_received" ? "bg-zinc-50" :
                          event.type === "wallet_charged" ? "bg-orange-500" :
                          "bg-zinc-400"
                        }`} />
                        {event.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-700">
                      {event.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12 text-zinc-400">
              No activity events yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
