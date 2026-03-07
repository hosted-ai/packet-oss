/**
 * hosted.ai API client
 *
 * DEPRECATED: This file is now a re-export shim for backwards compatibility.
 * The module has been split into:
 *   - src/lib/hostedai/types.ts - Type definitions
 *   - src/lib/hostedai/client.ts - Base API client
 *   - src/lib/hostedai/teams.ts - Team management
 *   - src/lib/hostedai/billing.ts - Billing/usage
 *   - src/lib/hostedai/instances.ts - Instance management
 *   - src/lib/hostedai/pools.ts - GPUaaS pool subscriptions
 *   - src/lib/hostedai/metrics.ts - GPU metrics
 *   - src/lib/hostedai/services.ts - Service exposure
 *
 * Import from "@/lib/hostedai" (this file) or from specific modules.
 */

export * from "./hostedai/index";
