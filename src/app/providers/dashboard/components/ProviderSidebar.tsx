"use client";

import Image from "next/image";
import Link from "next/link";
import type { ProviderTab } from "../types";
import {
  Server,
  DollarSign,
  TrendingUp,
  Wallet,
  Settings,
  FileText,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface ProviderSidebarProps {
  activeTab: ProviderTab;
  onTabChange: (tab: ProviderTab) => void;
  onLogout: () => void;
  companyName: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isAdminSession?: boolean;
}

interface NavItemDef {
  id: ProviderTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItemDef[] = [
  { id: "infrastructure", label: "Infrastructure", icon: Server },
  { id: "rates", label: "Rates", icon: DollarSign },
  { id: "revenue", label: "Revenue", icon: TrendingUp },
  { id: "payouts", label: "Payouts", icon: Wallet },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "docs", label: "Docs", icon: FileText },
];

export function ProviderSidebar({
  activeTab,
  onTabChange,
  onLogout,
  companyName,
  isCollapsed,
  onToggleCollapse,
  isAdminSession,
}: ProviderSidebarProps) {
  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-white border-r border-[var(--line)] flex flex-col transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-72"
      }`}
    >
      {/* Logo */}
      <div className={`border-b border-[var(--line)] ${isCollapsed ? "p-3" : "p-6"}`}>
        {isCollapsed ? (
          <Link href="/" className="flex items-center justify-center">
            <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center font-bold text-white text-lg">
              P
            </div>
          </Link>
        ) : (
          <Link href="/" className="flex items-center">
            <Image
              src="/packet-logo.png"
              alt="GPU Cloud"
              width={140}
              height={50}
              className="h-12 w-auto"
            />
          </Link>
        )}
      </div>

      {/* Company Info */}
      <div className={`border-b border-[var(--line)] ${isCollapsed ? "p-3" : "p-6"}`}>
        {isCollapsed ? (
          <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-violet-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
            {companyName.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-400 to-violet-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
              {companyName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[var(--muted)]">Provider</p>
              <p className="font-semibold text-[var(--ink)] truncate">{companyName}</p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 py-2.5 rounded-lg transition-colors text-left ${
                isCollapsed ? "justify-center px-3" : "px-4"
              } ${
                isActive
                  ? "bg-zinc-100 text-[var(--ink)] font-medium"
                  : "text-[var(--muted)] hover:bg-zinc-50 hover:text-zinc-700"
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-[var(--line)]">
        <button
          onClick={onToggleCollapse}
          className={`w-full flex items-center gap-3 py-3 text-sm font-medium text-[var(--muted)] hover:bg-zinc-50 hover:text-zinc-700 transition-colors ${
            isCollapsed ? "justify-center px-3" : "px-6"
          }`}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* Logout */}
      <div className={`border-t border-[var(--line)] ${isCollapsed ? "p-2" : "p-4"}`}>
        <button
          onClick={onLogout}
          title={isCollapsed ? (isAdminSession ? "Exit Provider View" : "Sign out") : undefined}
          className={`w-full flex items-center gap-3 py-2.5 text-sm font-medium text-[var(--muted)] hover:bg-zinc-50 hover:text-zinc-700 rounded-lg transition-colors ${
            isCollapsed ? "justify-center px-2" : "px-4"
          }`}
        >
          <LogOut className="w-5 h-5" />
          {!isCollapsed && <span>{isAdminSession ? "Exit Provider View" : "Sign out"}</span>}
        </button>
      </div>
    </aside>
  );
}
