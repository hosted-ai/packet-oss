/**
 * Checkout Widget -- TypeScript reference component.
 *
 * This file documents the CheckoutWidget interface in TypeScript. The actual
 * implementation lives in widget-bundle.ts as vanilla JS (inside the IIFE
 * template literal). This file exists for type safety, IDE support, and as
 * the authoritative reference for the component contract.
 *
 * Features:
 * - Two modes: "redirect" (default) and "embedded" (iframe)
 * - Redirect mode: shows a card with GPU info and a "Deploy Now" button
 *   that links to {dashboardUrl}/dashboard?gpu={gpuType}
 * - Embedded mode: creates an iframe pointing to /widget/checkout?gpu={gpuType}
 *   on the tenant's domain. Communicates via postMessage.
 * - If no GPU is selected, prompts the user to select one from the pricing widget
 * - Callbacks for checkout completion and errors
 *
 * GPU Catalog (for display):
 *   rtx-pro-6000: RTX PRO 6000, $0.66/hr, 96GB GDDR7
 *   b200: NVIDIA B200, $2.25/hr, 180GB HBM3e
 *   h200: NVIDIA H200, $1.50/hr, 141GB HBM3e
 *   h100: NVIDIA H100, $2.49/hr, 80GB HBM3
 */

import type { TenantWidgetConfig } from '../types';

// -- Public Interface ----------------------------------------------------------

/** Options specific to the checkout widget renderer. */
export interface CheckoutWidgetOptions {
  /** Color theme. 'auto' resolves via prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /** GPU type slug to check out (e.g., 'rtx-pro-6000'). */
  gpu?: string;
  /**
   * Checkout mode.
   * - 'redirect' (default): shows a card with GPU info and a button linking to the dashboard.
   * - 'embedded': renders an iframe hosting /widget/checkout for in-widget payment flow.
   */
  mode?: 'redirect' | 'embedded';
  /**
   * Callback fired when checkout completes.
   * In redirect mode: fires with the redirect URL before navigation.
   * In embedded mode: fires when the iframe posts a 'checkout-complete' message.
   */
  onCheckoutComplete?: (data: { orderId?: string; redirectUrl: string }) => void;
  /**
   * Callback fired on checkout errors.
   * In embedded mode: fires when the iframe posts a 'checkout-error' message.
   */
  onError?: (error: { message: string }) => void;
}

// -- Renderer -----------------------------------------------------------------

/**
 * Renders the checkout widget into a DOM element inside a Shadow DOM root.
 *
 * This function is the TypeScript reference for `renderCheckout` in
 * widget-bundle.ts. The bundle implementation is vanilla JS and must stay
 * in sync with this interface.
 *
 * @param root     - The .pw-root container element inside the shadow DOM.
 * @param config   - Tenant branding configuration from /api/widget/config.
 * @param origin   - The API origin URL (e.g., 'https://your-domain.com').
 * @param options  - Widget options including theme, gpu, mode, callbacks.
 * @returns        - Cleanup function that removes the postMessage listener (embedded mode only).
 *
 * Redirect mode lifecycle:
 * 1. If options.gpu is set, fetches GPU info from /api/widget/pricing.
 * 2. Renders a card showing GPU name, price, and specs.
 * 3. "Deploy Now" button links to {dashboardUrl}/dashboard?gpu={gpuType}.
 * 4. Fires onCheckoutComplete with redirect URL when clicked.
 * 5. If no GPU selected, shows prompt to select from pricing widget.
 *
 * Embedded mode lifecycle:
 * 1. Creates an iframe pointing to {origin}/widget/checkout?gpu={options.gpu}.
 * 2. Styles iframe seamlessly (no border, responsive width, auto height).
 * 3. Listens for postMessage events from the iframe:
 *    - { type: 'checkout-complete', orderId: '...' } -> fires onCheckoutComplete
 *    - { type: 'checkout-error', message: '...' } -> fires onError
 *    - { type: 'checkout-resize', height: N } -> resizes iframe
 * 4. Returns cleanup function that removes the message listener.
 *
 * DOM structure (redirect mode):
 * ```
 * .pw-checkout-card
 *   .pw-checkout-gpu-name           -- GPU display name
 *   .pw-checkout-gpu-specs          -- VRAM and architecture
 *   .pw-checkout-gpu-price          -- price per hour
 *   a.pw-checkout-btn               -- "Deploy Now" link button
 * ```
 *
 * DOM structure (embedded mode):
 * ```
 * .pw-checkout-iframe-wrap
 *   iframe.pw-checkout-iframe       -- /widget/checkout page
 * ```
 *
 * DOM structure (no GPU selected):
 * ```
 * .pw-checkout-empty
 *   .pw-checkout-empty-text         -- prompt to select a GPU
 * ```
 */
export function renderCheckoutWidget(
  root: HTMLElement,
  config: TenantWidgetConfig,
  origin: string,
  options: CheckoutWidgetOptions
): (() => void) | void {
  // Implementation is in widget-bundle.ts renderCheckout()
  void root;
  void config;
  void origin;
  void options;
}
