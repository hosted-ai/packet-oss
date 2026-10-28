"use client";

/**
 * The dashboard's dialog shell.
 *
 * 28 modal surfaces existed with no role, no aria-modal, no focus management and
 * almost no Escape handling (PA-677) — so a screen reader announced nothing on
 * open, focus stayed on the page behind the scrim, and Tab walked out of the
 * modal. This centralises the five things every one of them was missing; the
 * confirmDialog in components/feedback.tsx already proved the pattern.
 */

import { useCallback, useEffect, useId, useRef } from "react";

/** Tabbable descendants, in DOM order, skipping anything disabled or hidden.
    Deliberately not offsetParent-based: that is always null under jsdom, so a
    layout-free environment would see an empty list and trap focus on nothing. */
function tabbable(root: HTMLElement): HTMLElement[] {
  const sel = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    (el) =>
      !el.hasAttribute("hidden") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !el.closest('[hidden],[aria-hidden="true"]')
  );
}

export interface ModalProps {
  /** Accessible name for the dialog. Required — an unnamed dialog is the bug. */
  title: string;
  /** The child renders its own visible heading. Modal then names the dialog via
      aria-label instead of adding a second heading with the same text. */
  ownHeader?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes on the panel; defaults suit a mid-size form. */
  className?: string;
  /** Set false for a flow that must not be dismissed by scrim or Escape. */
  dismissible?: boolean;
  /** Rendered top-right in the header row. */
  headerAccessory?: React.ReactNode;
}

export function Modal({
  title,
  ownHeader = false,
  onClose,
  children,
  className = "bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto",
  dismissible = true,
  headerAccessory,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const close = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  // Remember the trigger, move focus in, and put it back on close.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreTo.current?.focus?.();
  }, []);

  // Escape closes; Tab cycles inside the panel instead of escaping to the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = tabbable(panelRef.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const onPanel = active === panelRef.current;
      if (e.shiftKey && (onPanel || active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        {...(ownHeader ? { "aria-label": title } : { "aria-labelledby": titleId })}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={className}
      >
        {!ownHeader && (
          <div className="flex items-center justify-between gap-3 p-5 pb-0">
            <h2 id={titleId} className="text-base font-semibold text-[var(--ink)]">
              {title}
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              {headerAccessory}
              {dismissible && (
                <button
                  onClick={onClose}
                  aria-label={`Close ${title}`}
                  className="text-[var(--muted)] hover:text-[var(--ink)] leading-none text-xl px-1 cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
