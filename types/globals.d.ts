// Ambient typings for the third-party analytics/marketing globals this app
// attaches to `window` (LinkedIn Insight, Growify, Google consent, my.hosted.ai
// analytics). Declaring them here lets call sites use `window.foo` directly
// instead of `(window as any).foo`, satisfying no-explicit-any (PA-273).
export {};

declare global {
  interface Window {
    /** my.hosted.ai analytics goal tracker */
    my_analytics?: { goal: (id: string) => void };
    /** LinkedIn Insight Tag */
    lintrk?: (event: string, data?: Record<string, unknown>) => void;
    /** Growify conversion pixel queue + shim */
    grp?: (...args: unknown[]) => void;
    grpQueue?: unknown[];
    /** Google consent / gtag */
    gtag?: (...args: unknown[]) => void;
  }
}
