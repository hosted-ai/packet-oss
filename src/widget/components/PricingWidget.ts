/**
 * Pricing Widget — TypeScript reference component.
 *
 * This file documents the PricingWidget interface in TypeScript. The actual
 * implementation lives in widget-bundle.ts as vanilla JS (inside the IIFE
 * template literal). This file exists for type safety, IDE support, and as
 * the authoritative reference for the component contract.
 *
 * Features:
 * - Fetches GPU pricing from /api/widget/pricing
 * - Skeleton loading animation (3-4 pulsing cards)
 * - Hourly / Monthly price toggle
 * - onSelect callback for custom integrations
 * - GPU highlight (border accent when options.gpu matches)
 * - Responsive card grid layout
 * - Theme support (light/dark/auto via CSS custom properties)
 */

import type { TenantWidgetConfig, GpuSelectionEvent } from '../types';

// ── Public Interface ──────────────────────────────────────────────────────

/** Options specific to the pricing widget renderer. */
export interface PricingWidgetOptions {
  /** Color theme. 'auto' resolves via prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /** GPU type slug to visually highlight (e.g., 'rtx-pro-6000'). */
  gpu?: string;
  /**
   * Callback fired when the user clicks "Get Started" on a GPU card.
   * When provided, the button fires this callback instead of navigating
   * to the dashboard URL.
   */
  onSelect?: (gpu: GpuSelectionEvent) => void;
}

/** Shape of a single GPU entry returned by /api/widget/pricing. */
export interface GpuPricingEntry {
  gpuType: string;
  name: string;
  hourlyRateCents: number;
  monthlyRateCents: number | null;
  specs: { vram: string; architecture: string } | null;
}

// ── Renderer ──────────────────────────────────────────────────────────────

/**
 * Renders the pricing widget into a DOM element inside a Shadow DOM root.
 *
 * This function is the TypeScript reference for `renderPricing` in
 * widget-bundle.ts. The bundle implementation is vanilla JS and must stay
 * in sync with this interface.
 *
 * @param root     - The .pw-root container element inside the shadow DOM.
 * @param config   - Tenant branding configuration from /api/widget/config.
 * @param origin   - The API origin URL (e.g., 'https://your-domain.com').
 * @param options  - Widget options including theme, gpu highlight, onSelect.
 *
 * Lifecycle:
 * 1. Renders skeleton loading cards (3 pulsing rectangles).
 * 2. Fetches GPU pricing data from `{origin}/api/widget/pricing`.
 * 3. Replaces skeleton with real pricing cards.
 * 4. Wires up hourly/monthly toggle and button click handlers.
 */
export function renderPricingWidget(
  root: HTMLElement,
  config: TenantWidgetConfig,
  origin: string,
  options: PricingWidgetOptions
): void {
  // --- Skeleton Loading ---
  // Show 3 skeleton cards with pulsing animation while data loads.
  // CSS class: .pw-skeleton-card with @keyframes pw-pulse.

  // --- Fetch & Render ---
  // GET {origin}/api/widget/pricing -> GpuPricingEntry[]
  //
  // For each GPU:
  //   - Card with name, specs (vram + architecture), price
  //   - Highlighted border when gpu.gpuType === options.gpu
  //   - "Get Started" button:
  //       If options.onSelect is set: fires callback with GpuSelectionEvent
  //       Otherwise: links to config.dashboardUrl

  // --- Hourly/Monthly Toggle ---
  // Toggle switch at the top of the grid.
  // Default: hourly. When toggled to monthly, cards show monthlyRateCents
  // (or "Contact us" if monthlyRateCents is null).

  // Implementation is in widget-bundle.ts renderPricing()
  void root;
  void config;
  void origin;
  void options;
}
