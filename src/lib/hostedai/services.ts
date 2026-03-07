/**
 * Service exposure functions for hosted.ai
 */

import { hostedaiRequest } from "./client";
import type {
  PodExposeServiceOpts,
  PodDiscoveredServices,
  PodUpdateExposedServiceOpts,
  ExposeServiceStatusResponse,
  ExposedServiceInfo,
} from "./types";

// Expose a new service on a pod
export async function exposeService(
  opts: PodExposeServiceOpts
): Promise<PodDiscoveredServices> {
  return hostedaiRequest<PodDiscoveredServices>(
    "POST",
    "/pods/expose-service",
    opts as unknown as Record<string, unknown>
  );
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

// View all exposed services for an instance
export async function getExposedServices(
  instanceId: string
): Promise<ExposedServiceInfo[]> {
  return hostedaiRequest<ExposedServiceInfo[]>(
    "GET",
    `/instances/unified/${instanceId}/exposed-services`
  );
}
