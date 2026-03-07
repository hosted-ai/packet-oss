"use client";

import type { NodeFormData } from "../types";

interface AddServerModalProps {
  form: NodeFormData;
  saving: boolean;
  error: string | null;
  onFormChange: (form: NodeFormData) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function AddServerModal({
  form,
  saving,
  error,
  onFormChange,
  onSubmit,
  onClose,
}: AddServerModalProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[#e4e7ef]">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-[#0b0f1c]">Add Server</h2>
            <button
              onClick={onClose}
              className="text-[#5b6476] hover:text-[#0b0f1c]"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-6">
            {/* Connection Details */}
            <div>
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                SSH Connection
              </h3>
              <p className="text-sm text-[#5b6476] mb-4">
                Provide SSH access so we can validate and manage the server. We
                recommend creating a dedicated user with sudo privileges.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    IP Address *
                  </label>
                  <input
                    type="text"
                    value={form.ipAddress}
                    onChange={(e) =>
                      onFormChange({ ...form, ipAddress: e.target.value })
                    }
                    placeholder="192.168.1.100"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    SSH Port *
                  </label>
                  <input
                    type="number"
                    value={form.sshPort}
                    onChange={(e) =>
                      onFormChange({ ...form, sshPort: e.target.value })
                    }
                    placeholder="22"
                    min="1"
                    max="65535"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={form.sshUsername}
                    onChange={(e) =>
                      onFormChange({ ...form, sshUsername: e.target.value })
                    }
                    placeholder="root"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Password *
                  </label>
                  <input
                    type="password"
                    value={form.sshPassword}
                    onChange={(e) =>
                      onFormChange({ ...form, sshPassword: e.target.value })
                    }
                    placeholder="••••••••"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                    required
                  />
                </div>
              </div>
            </div>

            {/* GPU Information */}
            <div>
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                GPU Information *
              </h3>
              <p className="text-sm text-[#5b6476] mb-4">
                Tell us about the GPUs in your server.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    GPU Model *
                  </label>
                  <input
                    type="text"
                    value={form.gpuModel}
                    onChange={(e) =>
                      onFormChange({ ...form, gpuModel: e.target.value })
                    }
                    placeholder="e.g. NVIDIA H100 80GB"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Number of GPUs *
                  </label>
                  <input
                    type="number"
                    value={form.gpuCount}
                    onChange={(e) =>
                      onFormChange({ ...form, gpuCount: e.target.value })
                    }
                    placeholder="8"
                    min="1"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Optional Details */}
            <div>
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                Server Details (Optional)
              </h3>
              <p className="text-sm text-[#5b6476] mb-4">
                Provide additional details to help identify the server. GPU
                information will be auto-detected during validation.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Hostname
                  </label>
                  <input
                    type="text"
                    value={form.hostname}
                    onChange={(e) =>
                      onFormChange({ ...form, hostname: e.target.value })
                    }
                    placeholder="gpu-server-01"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Datacenter
                  </label>
                  <input
                    type="text"
                    value={form.datacenter}
                    onChange={(e) =>
                      onFormChange({ ...form, datacenter: e.target.value })
                    }
                    placeholder="DC1"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Region
                  </label>
                  <select
                    value={form.region}
                    onChange={(e) =>
                      onFormChange({ ...form, region: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                  >
                    <option value="">Select region</option>
                    <option value="us-east">US East</option>
                    <option value="us-west">US West</option>
                    <option value="eu-west">EU West</option>
                    <option value="eu-central">EU Central</option>
                    <option value="asia-east">Asia East</option>
                    <option value="asia-south">Asia South</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Country
                  </label>
                  <input
                    type="text"
                    value={form.country}
                    onChange={(e) =>
                      onFormChange({ ...form, country: e.target.value })
                    }
                    placeholder="United States"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                  />
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg p-4">
              <h4 className="font-medium text-[#0b0f1c] mb-2">What happens next?</h4>
              <ol className="text-sm text-[#5b6476] space-y-1 list-decimal list-inside">
                <li>Your server request is submitted for review</li>
                <li>Our team will manually verify and provision your server</li>
                <li>You&apos;ll receive an email when your server is approved</li>
                <li>Once live, your server starts earning</li>
              </ol>
              <p className="text-xs text-[#5b6476] mt-3">
                This process typically takes 1-2 business days.
              </p>
            </div>

            {/* Error Display */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-[#e4e7ef] flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-[#e4e7ef] text-[#0b0f1c] rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                saving ||
                !form.ipAddress ||
                !form.sshPort ||
                !form.sshUsername ||
                !form.sshPassword ||
                !form.gpuModel ||
                !form.gpuCount
              }
              className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1a4fff]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Adding Server..." : "Add Server"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
