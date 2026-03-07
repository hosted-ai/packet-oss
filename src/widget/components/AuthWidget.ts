/**
 * Auth Widget -- TypeScript reference component.
 *
 * This file documents the AuthWidget interface in TypeScript. The actual
 * implementation lives in widget-bundle.ts as vanilla JS (inside the IIFE
 * template literal). This file exists for type safety, IDE support, and as
 * the authoritative reference for the component contract.
 *
 * Features:
 * - Email-only form (magic link auth -- no passwords)
 * - Toggle between "Sign in" and "Create account" modes (visual only -- both send magic link)
 * - Loading state with disabled button and spinner while API call is in progress
 * - Success state with checkmark icon and "Check your email" message
 * - Error state with inline error message (rate limited, invalid email, etc.)
 * - Client-side email format validation before API call
 * - Posts to /api/widget/auth with the user's email
 */

import type { TenantWidgetConfig } from '../types';

// -- Public Interface ----------------------------------------------------------

/** Options specific to the auth widget renderer. */
export interface AuthWidgetOptions {
  /** Color theme. 'auto' resolves via prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /**
   * Visual mode -- controls button label and toggle text.
   * Both modes do the same thing: send a magic link email.
   * Defaults to 'signup'.
   */
  mode?: 'signup' | 'login';
  /**
   * Callback fired when the magic link email is sent successfully.
   * Receives the email address and success message from the API.
   */
  onSuccess?: (data: { email: string; message: string }) => void;
  /**
   * Callback fired when the auth request fails.
   * Receives the error message from the API or client-side validation.
   */
  onError?: (error: { message: string }) => void;
}

// -- Renderer -----------------------------------------------------------------

/**
 * Renders the auth widget into a DOM element inside a Shadow DOM root.
 *
 * This function is the TypeScript reference for `renderAuth` in
 * widget-bundle.ts. The bundle implementation is vanilla JS and must stay
 * in sync with this interface.
 *
 * @param root     - The .pw-root container element inside the shadow DOM.
 * @param config   - Tenant branding configuration from /api/widget/config.
 * @param origin   - The API origin URL (e.g., 'https://your-domain.com').
 * @param options  - Widget options including theme, mode, onSuccess, onError.
 *
 * Lifecycle:
 * 1. Renders email input + submit button.
 * 2. On submit: validates email format client-side.
 * 3. Shows loading state (spinner, disabled button).
 * 4. POSTs to `{origin}/api/widget/auth` with `{ email }`.
 * 5. On success: shows checkmark + "Check your email for a login link".
 * 6. On error: shows inline error message, re-enables form.
 * 7. Toggle link switches between signup/login mode text (visual only).
 *
 * DOM structure:
 * ```
 * .pw-auth-form
 *   input.pw-auth-input[type="email"]       -- email field
 *   .pw-auth-error                          -- error message (hidden by default)
 *   button.pw-auth-btn                      -- submit button
 *     .pw-spinner                           -- loading spinner (hidden by default)
 *     span                                  -- button label
 *   .pw-auth-toggle                         -- mode toggle link
 *
 * .pw-auth-success (replaces form on success)
 *   .pw-auth-success-icon                   -- checkmark SVG
 *   .pw-auth-success-title                  -- "Check your email"
 *   .pw-auth-success-text                   -- descriptive text
 * ```
 */
export function renderAuthWidget(
  root: HTMLElement,
  config: TenantWidgetConfig,
  origin: string,
  options: AuthWidgetOptions
): void {
  // Implementation is in widget-bundle.ts renderAuth()
  void root;
  void config;
  void origin;
  void options;
}
