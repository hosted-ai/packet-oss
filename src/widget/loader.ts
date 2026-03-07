/**
 * Widget Loader — TypeScript source of truth.
 *
 * This file documents the loader logic in TypeScript. The actual served bundle
 * is a self-contained vanilla JS version in widget-bundle.ts. This file exists
 * for type safety and as the authoritative reference for the loader behavior.
 *
 * The loader:
 * 1. Auto-detects its script src to determine the API origin
 * 2. Fetches tenant config from {origin}/api/widget/config
 * 3. Scans the DOM for [data-packet-widget] elements
 * 4. Creates Shadow DOM inside each element
 * 5. Renders the appropriate widget with placeholder content
 * 6. Exposes window.PacketWidget for programmatic use
 */

import type {
  WidgetType,
  WidgetOptions,
  TenantWidgetConfig,
  WidgetInstance,
} from './types';
import { createWidgetContainer, injectStyles, createBaseStyles, resolveTheme } from './render';

const VALID_WIDGET_TYPES: WidgetType[] = ['pricing', 'checkout', 'auth', 'gpu-status'];

/** Detects the API origin from the currently executing script tag's src attribute. */
function detectOrigin(): string {
  const scripts = document.querySelectorAll('script[src]');
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = (scripts[i] as HTMLScriptElement).src;
    if (src.includes('widget.js')) {
      const url = new URL(src);
      return url.origin;
    }
  }
  return window.location.origin;
}

/** Fetches the tenant widget configuration from the API. */
async function fetchConfig(origin: string): Promise<TenantWidgetConfig> {
  const res = await fetch(`${origin}/api/widget/config`);
  if (!res.ok) throw new Error(`Failed to fetch widget config: ${res.status}`);
  return res.json();
}

/** Renders a placeholder loading state inside a shadow root. */
function renderLoading(shadow: ShadowRoot, _config: TenantWidgetConfig, _theme: 'light' | 'dark'): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'pw-root';
  wrapper.innerHTML = `
    <div class="pw-loading">
      <div class="pw-spinner"></div>
      <span>Loading widget...</span>
    </div>
  `;
  shadow.appendChild(wrapper);
}

/** Renders a placeholder for each widget type. Will be replaced by Tasks 17-20. */
function renderWidget(
  type: WidgetType,
  shadow: ShadowRoot,
  config: TenantWidgetConfig,
  theme: 'light' | 'dark',
  _options: WidgetOptions
): void {
  // Clear loading state
  const existing = shadow.querySelector('.pw-root');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'pw-root';

  const titles: Record<WidgetType, string> = {
    'pricing': 'GPU Pricing',
    'checkout': 'Checkout',
    'auth': 'Sign In',
    'gpu-status': 'GPU Availability',
  };

  wrapper.innerHTML = `
    <div class="pw-header">
      ${config.logoUrl ? `<img class="pw-header-logo" src="${config.logoUrl}" alt="${config.brandName}" />` : ''}
      <span class="pw-header-title">${titles[type] || type}</span>
    </div>
    <div class="pw-loading">
      <div class="pw-spinner"></div>
      <span>Loading ${titles[type]?.toLowerCase() || type}...</span>
    </div>
    <div class="pw-powered-by">
      Powered by <a href="${config.dashboardUrl}" target="_blank" rel="noopener">${config.brandName}</a>
    </div>
  `;

  shadow.appendChild(wrapper);
}

/** Mounts a single widget instance into a host element. */
async function mountWidget(
  host: HTMLElement,
  type: WidgetType,
  config: TenantWidgetConfig,
  options: WidgetOptions
): Promise<WidgetInstance> {
  const theme = resolveTheme(options.theme || 'light');
  const shadow = createWidgetContainer(host);
  const baseCSS = createBaseStyles(config, theme);
  injectStyles(shadow, baseCSS);

  // Show loading first
  renderLoading(shadow, config, theme);

  // Then render the actual widget placeholder
  renderWidget(type, shadow, config, theme, options);

  const id = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    type,
    host,
    shadow,
    options,
    destroy: () => {
      shadow.innerHTML = '';
      host.innerHTML = '';
    },
  };
}

/** Scans the DOM for declarative widget elements and mounts them. */
async function autoDiscover(config: TenantWidgetConfig): Promise<void> {
  const elements = document.querySelectorAll<HTMLElement>('[data-packet-widget]');

  for (const el of elements) {
    const type = el.getAttribute('data-packet-widget') as WidgetType;
    if (!VALID_WIDGET_TYPES.includes(type)) {
      console.warn(`[PacketWidget] Unknown widget type: "${type}"`);
      continue;
    }

    const options: WidgetOptions = {
      theme: (el.getAttribute('data-theme') as WidgetOptions['theme']) || 'light',
      gpu: el.getAttribute('data-gpu') || undefined,
      mode: (el.getAttribute('data-mode') as WidgetOptions['mode']) || undefined,
    };

    try {
      await mountWidget(el, type, config, options);
    } catch (err) {
      console.error(`[PacketWidget] Failed to mount ${type} widget:`, err);
    }
  }
}

/** Initializes the widget system. Called automatically on script load. */
async function init(): Promise<void> {
  const origin = detectOrigin();

  try {
    const config = await fetchConfig(origin);

    // Auto-discover declarative widgets
    await autoDiscover(config);

    // Expose programmatic API
    (window as unknown as Record<string, unknown>).PacketWidget = {
      render: async (type: WidgetType, opts: WidgetOptions = {}) => {
        if (!VALID_WIDGET_TYPES.includes(type)) {
          throw new Error(`Unknown widget type: "${type}"`);
        }

        let host: HTMLElement;
        if (typeof opts.container === 'string') {
          const el = document.querySelector<HTMLElement>(opts.container);
          if (!el) throw new Error(`Container not found: ${opts.container}`);
          host = el;
        } else if (opts.container instanceof HTMLElement) {
          host = opts.container;
        } else {
          throw new Error('A container (CSS selector or HTMLElement) is required');
        }

        return mountWidget(host, type, config, opts);
      },
      config,
      version: '1.0.0',
    };
  } catch (err) {
    console.error('[PacketWidget] Initialization failed:', err);
  }
}

// Auto-init when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { init, detectOrigin, fetchConfig, mountWidget, autoDiscover };
