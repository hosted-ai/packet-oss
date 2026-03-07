/**
 * Widget type definitions for the embeddable widget system.
 *
 * These types define the contract between the widget loader, the tenant
 * configuration API, and the individual widget renderers.
 */

/** Supported widget types that can be rendered via data attributes or programmatic API. */
export type WidgetType = 'pricing' | 'checkout' | 'auth' | 'gpu-status';

/** Options passed when rendering a widget programmatically via PacketWidget.render(). */
export interface WidgetOptions {
  /** CSS selector string or HTMLElement to render the widget into. */
  container?: string | HTMLElement;
  /** Color theme for the widget. 'auto' uses prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /** GPU type slug to filter or pre-select (e.g., 'rtx-pro-6000'). */
  gpu?: string;
  /** Auth widget mode: show signup or login form. */
  mode?: 'signup' | 'login';
  /** Callback fired when a GPU is selected in the pricing widget. */
  onSelect?: (gpu: GpuSelectionEvent) => void;
  /** Callback fired on any widget error. */
  onError?: (error: WidgetError) => void;
  /** Callback fired when a checkout flow completes. */
  onCheckoutComplete?: (order: CheckoutCompleteEvent) => void;
}

/** Tenant branding configuration returned by /api/widget/config. */
export interface TenantWidgetConfig {
  brandName: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  dashboardUrl: string;
  stripePublishableKey: string;
}

/** Event payload for GPU selection. */
export interface GpuSelectionEvent {
  gpuType: string;
  name: string;
  hourlyRateCents: number;
  monthlyRateCents: number | null;
}

/** Event payload for widget errors. */
export interface WidgetError {
  code: string;
  message: string;
  widgetType: WidgetType;
}

/** Event payload for checkout completion. */
export interface CheckoutCompleteEvent {
  orderId: string;
  gpuType: string;
  billingCycle: 'hourly' | 'monthly';
}

/** Internal representation of a mounted widget instance. */
export interface WidgetInstance {
  id: string;
  type: WidgetType;
  host: HTMLElement;
  shadow: ShadowRoot;
  options: WidgetOptions;
  destroy: () => void;
}
