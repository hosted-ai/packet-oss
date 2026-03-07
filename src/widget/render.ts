/**
 * Shadow DOM rendering utilities for the widget system.
 *
 * These utilities handle creating isolated Shadow DOM containers,
 * injecting styles, and generating base CSS from tenant configuration.
 * Used by the loader to set up each widget's rendering environment.
 */

import type { TenantWidgetConfig } from './types';

/**
 * Creates a Shadow DOM container attached to the given host element.
 * Uses 'open' mode so the widget internals can be inspected and the
 * loader can update content after initialization.
 */
export function createWidgetContainer(host: HTMLElement): ShadowRoot {
  // Clear any existing content in the host
  host.innerHTML = '';

  // Attach shadow root
  const shadow = host.attachShadow({ mode: 'open' });

  return shadow;
}

/**
 * Injects a <style> element into a Shadow DOM root.
 * Returns the created style element for later updates.
 */
export function injectStyles(shadow: ShadowRoot, css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  return style;
}

/**
 * Generates the base CSS custom properties and reset styles for a widget,
 * derived from the tenant's branding configuration and the active theme.
 */
export function createBaseStyles(config: TenantWidgetConfig, theme: 'light' | 'dark'): string {
  const isLight = theme === 'light';

  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .pw-root {
      --pw-primary: ${config.primaryColor};
      --pw-accent: ${config.accentColor};
      --pw-bg: ${isLight ? '#ffffff' : '#0f1117'};
      --pw-surface: ${isLight ? '#f7f8fb' : '#1a1d27'};
      --pw-border: ${isLight ? '#e2e5ea' : '#2a2d37'};
      --pw-text: ${isLight ? '#0b0f1c' : '#e8eaed'};
      --pw-text-muted: ${isLight ? '#5b6476' : '#8b92a5'};
      --pw-radius: 8px;
      --pw-radius-lg: 12px;
      --pw-shadow: ${isLight
        ? '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)'
        : '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)'};

      background: var(--pw-bg);
      color: var(--pw-text);
      padding: 16px;
      border-radius: var(--pw-radius-lg);
      border: 1px solid var(--pw-border);
    }

    .pw-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      color: var(--pw-text-muted);
      font-size: 14px;
      gap: 8px;
    }

    .pw-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--pw-border);
      border-top-color: var(--pw-primary);
      border-radius: 50%;
      animation: pw-spin 0.6s linear infinite;
    }

    @keyframes pw-spin {
      to { transform: rotate(360deg); }
    }

    .pw-error {
      padding: 16px;
      color: #dc2626;
      font-size: 14px;
      text-align: center;
      background: ${isLight ? '#fef2f2' : '#1c0f0f'};
      border-radius: var(--pw-radius);
    }

    .pw-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--pw-border);
    }

    .pw-header-logo {
      height: 24px;
      width: auto;
    }

    .pw-header-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--pw-text);
    }

    .pw-powered-by {
      font-size: 11px;
      color: var(--pw-text-muted);
      text-align: center;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--pw-border);
    }

    .pw-powered-by a {
      color: var(--pw-primary);
      text-decoration: none;
    }

    .pw-powered-by a:hover {
      text-decoration: underline;
    }
  `;
}

/**
 * Resolves the effective theme, accounting for 'auto' by checking
 * the user's prefers-color-scheme media query.
 */
export function resolveTheme(theme: 'light' | 'dark' | 'auto'): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}
