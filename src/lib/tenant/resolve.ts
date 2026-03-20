/**
 * Stub tenant resolver for OSS builds.
 * The full tenant system is Pro-only. This stub exists so shared code
 * that dynamically requires tenant/resolve compiles in the OSS build.
 * These functions should never be called in OSS — edition guards prevent it.
 */
import type { TenantConfig } from "./types";

export function getDefaultTenantConfig(): TenantConfig {
  throw new Error("Tenant system is not available in the OSS edition");
}

export function resolveTenant(): TenantConfig {
  throw new Error("Tenant system is not available in the OSS edition");
}
