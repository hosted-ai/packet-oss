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
  }
}
