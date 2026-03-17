/**
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded by Next.js when the server starts.
 * It initializes the internal cron scheduler for background jobs.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server, not during build or in Edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronScheduler } = await import("@/lib/cron-scheduler");
    startCronScheduler();

    // Warm the platform settings cache so getSettingSync() works from first request
    const { warmSettingsCache } = await import("@/lib/settings");
    await warmSettingsCache().catch((error) => {
      console.error("[Instrumentation] Failed to warm settings cache:", error);
    });

    // Initialize default policies and roles from hosted.ai API
    // Awaited so the cache is warm before any request handler runs
    const { initializeDefaultPolicies, initializeRoles } = await import("@/lib/hostedai");
    await Promise.all([
      initializeDefaultPolicies().catch((error) => {
        console.error("[Instrumentation] Failed to initialize default policies:", error);
      }),
      initializeRoles().catch((error) => {
        console.error("[Instrumentation] Failed to initialize default roles:", error);
      }),
    ]);
  }
}
