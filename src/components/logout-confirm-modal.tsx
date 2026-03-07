"use client";

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  variant?: "dark" | "light";
}

export function LogoutConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  variant = "dark",
}: LogoutConfirmModalProps) {
  if (!isOpen) return null;

  const isDark = variant === "dark";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative z-10 w-full max-w-md rounded-xl p-6 shadow-xl ${
          isDark ? "bg-zinc-900 border border-zinc-700" : "bg-white border border-gray-200"
        }`}
      >
        <h2
          className={`text-xl font-semibold mb-4 ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          Log out?
        </h2>

        <p className={`mb-6 ${isDark ? "text-zinc-400" : "text-gray-600"}`}>
          Are you sure you want to log out? You&apos;ll need to request a new login link to access your account again.
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isDark
                ? "bg-zinc-800 text-white hover:bg-zinc-700"
                : "bg-gray-100 text-gray-900 hover:bg-gray-200"
            }`}
          >
            Stay logged in
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
