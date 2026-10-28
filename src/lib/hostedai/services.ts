/**
 * Service exposure functions for hosted.ai
 */

import { hostedaiRequest } from "./client";
import { isUnifiedInstanceId } from "./instances";
import type {
  PodExposeServiceOpts,
  PodDiscoveredServices,
  PodUpdateExposedServiceOpts,
  ExposeServiceStatusResponse,
  ExposedServiceInfo,
} from "./types";

// Callers hold the id as it arrives — a request body, a route param, an
// instance id — so the subscription id is narrowed here rather than by each one.
export type ExposeServiceOpts = Omit<PodExposeServiceOpts, "pool_subscription_id"> & {
  pool_subscription_id?: number | string | null;
};

// Expose a new service on a pod
export async function exposeService(
  opts: ExposeServiceOpts
): Promise<PodDiscoveredServices> {
  return hostedaiRequest<PodDiscoveredServices>(
    "POST",
    "/pods/expose-service",
    normalizeExposeOpts(opts) as unknown as Record<string, unknown>
  );
}

// HAI resolves a unified instance from `pod_name` alone, and a pool worker from
// `pod_name` plus a numeric `pool_subscription_id`, so it gets one form or the other.
function normalizeExposeOpts(opts: ExposeServiceOpts): PodExposeServiceOpts {
  const { pool_subscription_id: subscriptionId, ...rest } = opts;
  if (isUnifiedInstanceId(subscriptionId)) {
    return { ...rest, pod_name: subscriptionId };
  }
  const numericId = Number(subscriptionId);
  return Number.isFinite(numericId) && numericId > 0
    ? { ...rest, pool_subscription_id: numericId }
    : rest;
}

// Check status of service exposure operation
export async function getExposeServiceStatus(
  serviceName: string,
  poolSubscriptionId: number,
  operationId?: string
): Promise<ExposeServiceStatusResponse> {
  return hostedaiRequest<ExposeServiceStatusResponse>(
    "GET",
    "/pods/expose-service/status",
    {
      service_name: serviceName,
      pool_subscription_id: poolSubscriptionId,
      operation_id: operationId,
    }
  );
}

// Update an exposed service
export async function updateExposedService(
  opts: PodUpdateExposedServiceOpts
): Promise<PodDiscoveredServices> {
  return hostedaiRequest<PodDiscoveredServices>(
    "PUT",
    "/pods/update-exposed-service",
    opts as unknown as Record<string, unknown>
  );
}

// Delete an exposed service
export async function deleteExposedService(
  serviceId: number
): Promise<PodDiscoveredServices> {
  return hostedaiRequest<PodDiscoveredServices>(
    "DELETE",
    `/pods/delete-exposed-service/${serviceId}`
  );
}

// View all exposed services for an instance. The platform answers
// `{services, networking}`; a bare array and a null body both predate it.
export async function getExposedServices(
  instanceId: string
): Promise<ExposedServiceInfo[]> {
  const result = await hostedaiRequest<unknown>(
    "GET",
    `/instances/unified/${instanceId}/exposed-services`
  );
  return readServiceRows(result);
}

// Reads whichever field carries the rows, so a caller always gets an array and
// never maps over an envelope.
function readServiceRows(body: unknown): ExposedServiceInfo[] {
  if (Array.isArray(body)) return body as ExposedServiceInfo[];
  const rows = (body as { services?: unknown } | null)?.services;
  return Array.isArray(rows) ? (rows as ExposedServiceInfo[]) : [];
}
