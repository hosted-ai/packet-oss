"use client";

import type { AdminTab } from "../types";
import { PREMIUM_ADMIN_TABS, OSS_ONLY_ADMIN_TABS } from "../types";
import { isPro, isOSS } from "@/lib/edition";
import { useSecurityHealth } from "@/hooks/useSecurityHealth";
import {
  Users,
  Shield,
  LineChart,
  Server,
  FileText,
  Share2,
  Tag,
  Activity,
  Settings,
  CalculatorIcon,
  FlaskConical,
  Building,
  Building2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Gamepad2,
  Package,
  Cpu,
  Mail,
  Monitor,
  Layers,
  TrendingUp,
  ShoppingCart,
  Database,
  Coins,
  Cloud,
  Headphones,
  Globe,
  DollarSign,
  Megaphone,
  BarChart3,
  ImageIcon,
  Clock,
  Wallet,
  Wrench,
} from "lucide-react";

interface AdminSidebarProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onLogout: () => void;
  adminEmail: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: AdminTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "White Label",
    items: [
      { id: "tenants" as AdminTab, label: "Tenants", icon: Building2 },
    ],
  },
  {
    label: "Users",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "admins", label: "Admins", icon: Shield },
      { id: "investors", label: "Investors", icon: LineChart },
      { id: "providers", label: "Providers", icon: Building },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { id: "pods", label: "GPU Pods", icon: Cpu },
      { id: "pools", label: "Pool Overview", icon: Layers },
      { id: "nodes", label: "Node Monitoring", icon: Monitor },
      { id: "token-providers", label: "Token Providers", icon: Coins },
      { id: "skypilot", label: "SkyPilot", icon: Cloud },
      { id: "spheron", label: "Spheron Inventory", icon: Globe },
      { id: "uptime", label: "Pod Uptime", icon: Clock },
    ],
  },
  {
    label: "Business",
    items: [
      { id: "payouts", label: "Investor Payouts", icon: Wallet },
      { id: "node-revenue", label: "Node Revenue", icon: DollarSign },
      { id: "pixel-factory", label: "Pixel Factory", icon: ImageIcon },
      { id: "marketing", label: "Marketing", icon: BarChart3 },
      { id: "business", label: "Business Metrics", icon: TrendingUp },
      { id: "products", label: "Products", icon: Package },
      { id: "landing", label: "Landing Page", icon: LayoutDashboard },
      { id: "clusters", label: "Clusters", icon: Server },
      { id: "demand", label: "Demand", icon: ShoppingCart },
      { id: "quotes", label: "Quotes", icon: FileText },
      { id: "referrals", label: "Referrals", icon: Share2 },
      { id: "vouchers", label: "Vouchers", icon: Tag },
      { id: "banners", label: "Banners", icon: Megaphone },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "support", label: "Support", icon: Headphones },
      { id: "batches", label: "Batch Jobs", icon: Database },
      { id: "emails", label: "Email Templates", icon: Mail },
      { id: "email-log", label: "Email Log", icon: Mail },
      { id: "drip", label: "Drip Campaigns", icon: Mail },
      { id: "game", label: "Game Stats", icon: Gamepad2 },
      { id: "activity", label: "Activity", icon: Activity },
      { id: "calculator", label: "Calculator", icon: CalculatorIcon },
      { id: "qa", label: "QA", icon: FlaskConical },
      { id: "settings", label: "Settings", icon: Settings },
      { id: "platform-settings" as AdminTab, label: "Platform Settings", icon: Wrench },
    ],
  },
];

export function AdminSidebar({
  activeTab,
  onTabChange,
  onLogout,
  adminEmail,
  isCollapsed,
  onToggleCollapse,
}: AdminSidebarProps) {
  const { data: securityHealth, loading: securityLoading } = useSecurityHealth();
  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-[#0b0f1c] text-white flex flex-col transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Logo/Brand */}
      <div className={`border-b border-white/10 ${isCollapsed ? "p-3" : "p-6"}`}>
        {isCollapsed ? (
          <div className="w-10 h-10 bg-[#1a4fff] rounded-lg flex items-center justify-center font-bold text-lg">
            A
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold">Admin Panel</h1>
            <p className="text-sm text-gray-400 truncate mt-1 flex items-center gap-1.5">
              <span className="truncate">{adminEmail}</span>
              {!securityLoading && securityHealth && (
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    securityHealth.score >= 3
                      ? "bg-green-500"
                      : securityHealth.score === 2
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  }`}
                  title={`Security: ${securityHealth.score}/${securityHealth.maxScore}`}
                />
              )}
            </p>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => {
            if (PREMIUM_ADMIN_TABS.has(item.id)) return isPro();
            if (OSS_ONLY_ADMIN_TABS.has(item.id)) return isOSS();
            return true;
          });
          if (items.length === 0) return null;
          return (
          <div key={group.label} className="mb-6">
            {!isCollapsed && (
              <h2 className="px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {group.label}
              </h2>
            )}
            <ul className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => onTabChange(item.id)}
                      title={isCollapsed ? item.label : undefined}
                      className={`w-full flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${
                        isCollapsed ? "justify-center px-3" : "px-6"
                      } ${
                        isActive
                          ? "bg-[#1a4fff] text-white"
                          : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {!isCollapsed && <span>{item.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </nav>

      {/* Version */}
      {!isCollapsed && process.env.NEXT_PUBLIC_APP_VERSION && (
        <div className="px-6 py-2 border-t border-white/10">
          <p className="text-xs text-gray-500">v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
        </div>
      )}

      {/* Collapse Toggle */}
      <div className="border-t border-white/10">
        <button
          onClick={onToggleCollapse}
          className={`w-full flex items-center gap-3 py-3 text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-white transition-colors ${
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
      <div className={`border-t border-white/10 ${isCollapsed ? "p-2" : "p-4"}`}>
        <button
          onClick={onLogout}
          title={isCollapsed ? "Logout" : undefined}
          className={`w-full flex items-center gap-3 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/5 hover:text-white rounded-lg transition-colors ${
            isCollapsed ? "justify-center px-2" : "px-4"
          }`}
        >
          <LogOut className="w-5 h-5" />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
