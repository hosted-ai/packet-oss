"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { getLogoUrl } from "@/lib/branding";

interface MobileHeaderProps {
  balance: string;
  userName: string;
  onMenuOpen: () => void;
  onTopUp: () => void;
  logoUrl?: string;
}

export function MobileHeader({ balance, onMenuOpen, onTopUp, logoUrl }: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-[var(--line)] px-4 py-3 md:hidden">
      <div className="flex items-center justify-between">
        <button
          onClick={onMenuOpen}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-zinc-100 transition-colors"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link href="/" className="flex items-center gap-1.5">
          <Image
            src={logoUrl || getLogoUrl()}
            alt="Logo"
            width={100}
            height={36}
            className="h-8 w-auto"
          />
        </Link>

        <button
          onClick={onTopUp}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 text-white rounded-xl text-sm font-semibold"
        >
          <span>{balance}</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </header>
  );
}

interface MobileNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  hasUnreadSupport?: boolean;
}

export function MobileNav({ activeTab, onTabChange, hasUnreadSupport }: MobileNavProps) {
  const tabs = [
    { id: "dashboard", label: "Home", icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: "tokenfactory", label: "Tokens", icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    )},
    { id: "billing", label: "Billing", icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )},
    { id: "settings", label: "Settings", icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
    { id: "more", label: "More", icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
      </svg>
    ), badge: hasUnreadSupport },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[var(--line)] px-2 pb-safe md:hidden">
      <div className="flex items-center justify-around py-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id ||
            (tab.id === "more" && ["huggingface", "apps", "storage", "metrics", "support", "referrals", "team", "baremetal"].includes(activeTab));

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors min-w-[64px] relative ${
                isActive ? "text-[var(--blue)]" : "text-zinc-500"
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.label}</span>
              {tab.badge && (
                <span className="absolute top-1 right-2 w-2 h-2 bg-rose-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface MobileMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  isOwner: boolean;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
  onBillingPortal: () => void;
  billingPortalLoading: boolean;
}

export function MobileMenuSheet({
  isOpen,
  onClose,
  userName,
  userEmail,
  isOwner,
  onTabChange,
  onLogout,
  onBillingPortal,
  billingPortalLoading,
}: MobileMenuSheetProps) {
  if (!isOpen) return null;

  const handleTabClick = (tab: string) => {
    onTabChange(tab);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 md:hidden animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 top-0 z-50 bg-white rounded-b-3xl max-h-[85vh] overflow-y-auto md:hidden animate-in slide-in-from-top duration-300">
        <div className="p-6">
          {/* User Info */}
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-[var(--line)]">
            <div className="w-14 h-14 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[var(--ink)] truncate">{userName}</p>
              <p className="text-sm text-[var(--muted)] truncate">{userEmail}</p>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-zinc-100"
            >
              <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Menu Items */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider px-3 mb-2">Compute</p>

            <button onClick={() => handleTabClick("huggingface")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <span className="text-xl">🤗</span>
              <span className="font-medium text-[var(--ink)]">Hugging Face</span>
            </button>

            <button onClick={() => handleTabClick("apps")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Apps</span>
            </button>

            <button onClick={() => handleTabClick("storage")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Storage</span>
            </button>

            <button onClick={() => handleTabClick("baremetal")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Bare Metal</span>
            </button>

            <button onClick={() => handleTabClick("metrics")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Metrics</span>
            </button>

            <div className="my-4 border-t border-[var(--line)]" />
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider px-3 mb-2">Account</p>

            {isOwner && (
              <button onClick={() => handleTabClick("team")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
                <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <span className="font-medium text-[var(--ink)]">Team</span>
              </button>
            )}

            <div className="my-4 border-t border-[var(--line)]" />
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider px-3 mb-2">Help</p>

            <a href="/dashboard?tab=docs" className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Documentation</span>
              <svg className="w-4 h-4 text-zinc-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>

            <button onClick={() => handleTabClick("support")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Support</span>
            </button>

            <button onClick={() => handleTabClick("referrals")} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors">
              <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
              <span className="font-medium text-[var(--ink)]">Referrals</span>
            </button>

            <div className="my-4 border-t border-[var(--line)]" />

            <button
              onClick={onBillingPortal}
              disabled={billingPortalLoading}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              {billingPortalLoading ? (
                <svg className="w-5 h-5 text-zinc-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              ) : (
                <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              )}
              <span className="font-medium text-[var(--ink)]">Stripe Portal</span>
            </button>

            <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-rose-50 transition-colors text-rose-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="font-medium">Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface MobileMoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onTabChange: (tab: string) => void;
  hasUnreadSupport?: boolean;
}

export function MobileMoreSheet({ isOpen, onClose, onTabChange, hasUnreadSupport }: MobileMoreSheetProps) {
  if (!isOpen) return null;

  const handleTabClick = (tab: string) => {
    onTabChange(tab);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 md:hidden animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl pb-safe md:hidden animate-in slide-in-from-bottom duration-300">
        <div className="p-6">
          {/* Handle */}
          <div className="w-10 h-1 bg-zinc-300 rounded-full mx-auto mb-6" />

          <div className="grid grid-cols-3 gap-4">
            <button onClick={() => handleTabClick("huggingface")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <span className="text-2xl">🤗</span>
              <span className="text-xs font-medium text-[var(--ink)]">Hugging Face</span>
            </button>

            <button onClick={() => handleTabClick("apps")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Apps</span>
            </button>

            <button onClick={() => handleTabClick("storage")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Storage</span>
            </button>

            <button onClick={() => handleTabClick("baremetal")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Bare Metal</span>
            </button>

            <button onClick={() => handleTabClick("metrics")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Metrics</span>
            </button>

            <button onClick={() => handleTabClick("support")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors relative">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center relative">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {hasUnreadSupport && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white" />
                )}
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Support</span>
            </button>

            <button onClick={() => handleTabClick("referrals")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Referrals</span>
            </button>

            <button onClick={() => handleTabClick("team")} className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-zinc-50 transition-colors">
              <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-[var(--ink)]">Team</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
