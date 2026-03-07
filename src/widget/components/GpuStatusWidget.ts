/**
 * GPU Status Widget — TypeScript reference component.
 *
 * This file documents the GpuStatusWidget interface in TypeScript. The actual
 * implementation lives in widget-bundle.ts as vanilla JS (inside the IIFE
 * template literal). This file exists for type safety, IDE support, and as
 * the authoritative reference for the component contract.
 *
 * Features:
 * - Fetches GPU availability from /api/widget/gpu-status
 * - Green/yellow/red status dots (not text badges) per GPU type
 * - Polls every 30 seconds (configurable) with auto-refresh
 * - Compact mode for sidebar embedding (smaller font, tighter spacing)
 * - "Updated X seconds ago" timestamp between polls
 * - Clean destroy — clears polling interval when widget is removed
 */

import type { TenantWidgetConfig } from '../types';

// ── Public Interface ──────────────────────────────────────────────────────

/** Options specific to the GPU status widget renderer. */
export interface GpuStatusWidgetOptions {
  /** Color theme. 'auto' resolves via prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /** Compact mode — smaller font sizes, tighter padding, hidden header. */
  compact?: boolean;
  /**
   * Polling interval in milliseconds. Defaults to 30000 (30 seconds).
   * The widget re-fetches GPU status on this interval and updates the DOM
   * in-place (no full re-render).
   */
  pollInterval?: number;
}

/** Shape of a single GPU entry returned by /api/widget/gpu-status. */
export interface GpuStatusEntry {
  /** GPU type slug, e.g. 'rtx-pro-6000'. */
  gpuType: string;
  /** Human-readable GPU name, e.g. 'RTX PRO 6000'. */
  name: string;
  /** Availability status: 'available', 'limited', or 'sold-out'. */
  status: 'available' | 'limited' | 'sold-out';
}

/** Cleanup handle returned by the renderer. */
export interface GpuStatusWidgetCleanup {
  /** Clears the polling interval and stops the "last updated" timer. */
  destroy: () => void;
}

// ── Status Dot Colors ──────────────────────────────────────────────────────

/**
 * Status dot color map. Used for the 8px circles next to each GPU name.
 *
 * - available:  #22c55e (green) — with a subtle CSS pulse animation
 * - limited:    #eab308 (yellow)
 * - sold-out:   #ef4444 (red)
 */
export const STATUS_DOT_COLORS = {
  available: '#22c55e',
  limited: '#eab308',
  'sold-out': '#ef4444',
} as const;

// ── Renderer ──────────────────────────────────────────────────────────────

/**
 * Renders the GPU status widget into a DOM element inside a Shadow DOM root.
 *
 * This function is the TypeScript reference for `renderGpuStatus` in
 * widget-bundle.ts. The bundle implementation is vanilla JS and must stay
 * in sync with this interface.
 *
 * @param root     - The .pw-root container element inside the shadow DOM.
 * @param config   - Tenant branding configuration from /api/widget/config.
 * @param origin   - The API origin URL (e.g., 'https://your-domain.com').
 * @param options  - Widget options including theme, compact, pollInterval.
 * @returns        - Cleanup handle with a `destroy()` method.
 *
 * Lifecycle:
 * 1. Shows loading spinner.
 * 2. Fetches GPU status data from `{origin}/api/widget/gpu-status`.
 * 3. Renders a list of GPU items with status dots (green/yellow/red).
 * 4. Shows "Updated X seconds ago" at the bottom.
 * 5. Sets up polling interval (default: 30s) to re-fetch and update in-place.
 * 6. Returns cleanup handle to stop polling and clear timers.
 *
 * DOM structure:
 * ```
 * .pw-status-list
 *   .pw-status-item[data-gpu-type="..."]
 *     .pw-status-info
 *       .pw-status-name       — GPU name
 *     .pw-status-indicator
 *       .pw-status-dot        — 8px colored circle
 *       .pw-status-label      — "Available" / "Limited" / "Sold Out"
 *   .pw-last-updated          — "Updated 12s ago"
 * ```
 *
 * Compact mode (options.compact = true):
 * - Adds .pw-compact class to root
 * - Smaller font sizes (12px body, 11px label)
 * - Tighter padding (8px instead of 12px)
 * - Widget header is hidden via CSS
 */
export function renderGpuStatusWidget(
  root: HTMLElement,
  config: TenantWidgetConfig,
  origin: string,
  options: GpuStatusWidgetOptions
): GpuStatusWidgetCleanup {
  // --- Loading State ---
  // Show spinner while initial fetch completes.

  // --- Fetch & Render ---
  // GET {origin}/api/widget/gpu-status -> GpuStatusEntry[]
  //
  // For each GPU:
  //   - Status dot (.pw-status-dot) with colored background:
  //       available  -> #22c55e (green) + pulse animation
  //       limited    -> #eab308 (yellow)
  //       sold-out   -> #ef4444 (red)
  //   - GPU name text
  //   - Status label text (capitalized)

  // --- Polling ---
  // setInterval at options.pollInterval (default 30000ms)
  // On each poll:
  //   - Re-fetch /api/widget/gpu-status
  //   - Update existing DOM elements in-place (match by data-gpu-type)
  //   - Reset lastUpdated timestamp

  // --- Last Updated ---
  // setInterval at 1s to increment "Updated Xs ago" counter
  // Reset counter to 0 after each successful poll

  // --- Compact Mode ---
  // When options.compact is true:
  //   - Add .pw-compact to root element
  //   - CSS handles smaller sizes and hidden header

  // --- Cleanup ---
  // Returns { destroy } that clears both intervals (poll + counter)

  // Implementation is in widget-bundle.ts renderGpuStatus()
  void root;
  void config;
  void origin;
  void options;

  return { destroy: () => {} };
}
