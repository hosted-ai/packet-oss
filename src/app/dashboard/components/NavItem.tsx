/**
 * NavItem - sidebar navigation item component
 */

import React from "react";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  showBadge?: boolean;
  badge?: string;
}

export function NavItem({ icon, label, active, onClick, showBadge, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors text-left ${
        active
          ? "bg-zinc-100 text-[var(--ink)] font-medium"
          : "text-[var(--muted)] hover:bg-zinc-50 hover:text-zinc-700"
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
      {badge && (
        <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 rounded">
          {badge}
        </span>
      )}
      {showBadge && (
        <svg className="ml-auto w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}
