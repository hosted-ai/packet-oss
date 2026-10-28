/**
 * TypeScript declarations for the Crisp live chat SDK.
 *
 * Before the SDK script loads, window.$crisp is a plain array that queues
 * push() calls.  Once the SDK initialises it replaces/extends the array with
 * a full SDK object that adds get/is on top of the queue interface.
 * We model both by extending Array<unknown[]> with the post-init methods.
 *
 * This is an ambient script file (no imports/exports) so Window augmentation
 * does NOT need a `declare global` wrapper.
 */

interface CrispSDK extends Array<unknown[]> {
  /** Read a value set earlier (only available after SDK initialises). */
  get?: (key: string) => string | undefined;
  /** Check a boolean state (only available after SDK initialises). */
  is?: (key: string) => boolean;
}

interface Window {
  /** Crisp chat SDK / pre-init command queue. */
  $crisp: CrispSDK;
  /** Crisp website ID injected before the SDK script loads. */
  CRISP_WEBSITE_ID: string;
  /**
   * Stable per-user token that links this browser session to an existing
   * Crisp conversation.  Must be set before the SDK script runs to restore
   * cross-device conversation history.  We use the Stripe customer ID as a
   * stable, unique identifier.
   */
  CRISP_TOKEN_ID?: string;
}
