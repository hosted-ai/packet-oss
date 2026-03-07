/**
 * Transactions Modal Component
 *
 * Modal displaying all transactions with download option.
 *
 * @module dashboard/modals/TransactionsModal
 */

"use client";

interface Transaction {
  id: string;
  type: "credit" | "debit";
  description: string;
  amount: number;
  amountFormatted: string;
  created: number;
}

interface TransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: Transaction[];
  formatDateTime: (timestamp: number) => string;
  onDownloadCSV: () => void;
}

export function TransactionsModal({
  isOpen,
  onClose,
  transactions,
  formatDateTime,
  onDownloadCSV,
}: TransactionsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-3xl mx-4 shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ink)]">All Transactions</h3>
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
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} total
        </div>

        <div className="flex-1 overflow-y-auto border border-[var(--line)] rounded-xl">
          {transactions.length > 0 ? (
            <table className="w-full">
              <thead className="bg-zinc-50 sticky top-0">
                <tr>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Date & Time</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Description</th>
                  <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 text-sm text-zinc-600 whitespace-nowrap">
                      {formatDateTime(txn.created)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${txn.type === "credit" ? "bg-zinc-50" : "bg-zinc-300"}`} />
                        <span className="text-sm text-zinc-700">{txn.description}</span>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-sm font-mono text-right ${txn.type === "credit" ? "text-zinc-700" : "text-zinc-500"}`}>
                      {txn.type === "credit" ? "+" : "−"}{txn.amountFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-12 text-zinc-400">
              No transactions yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
