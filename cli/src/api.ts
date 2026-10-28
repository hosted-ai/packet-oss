import { getApiKey, getApiUrl } from "./config.js";
import type { components, operations } from "./generated/public-api.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not authenticated. Run 'gpu-cloud login' first.");
  }

  const url = `${getApiUrl()}/api/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData: Partial<components["schemas"]["Error"]> = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorData.error?.message || `HTTP ${response.status}`);
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}

// Request and response types, generated from the public API spec pinned in openapi/public.json.

type JsonBody<R> = R extends { content: { "application/json": infer B } } ? B : never;
type Data<Op extends keyof operations> = JsonBody<
  operations[Op]["responses"][keyof operations[Op]["responses"] & (200 | 201)]
> extends { data?: infer D }
  ? D
  : never;
type RequestBody<Op extends keyof operations> = JsonBody<operations[Op]["requestBody"]>;

export type Account = Data<"getAccount">;
export type LaunchOptions = Data<"getLaunchOptions">;
export type Instance = components["schemas"]["Instance"];
export type InstanceList = Data<"listInstances">;
export type InstanceDetail = Data<"getInstance">;
export type UpdateInstanceRequest = RequestBody<"updateInstance">;
export type ConnectionInfo = Data<"getInstanceConnection">;
export type CreateInstanceRequest = RequestBody<"createInstance">;
export type CreateInstanceResult = Data<"createInstance">;
export type ExposedService = components["schemas"]["Service"];
export type ExposeServiceRequest = RequestBody<"exposeService">;
export type ExposeServiceResult = Data<"exposeService">;
export type DeleteServiceResult = Data<"deleteService">;
