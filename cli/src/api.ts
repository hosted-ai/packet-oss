import { getApiKey, getApiUrl } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiResponse<T> {
  data: T;
  meta?: {
    [key: string]: any;
  };
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
      "X-API-Key": apiKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
    throw new ApiError(
      response.status,
      errorMessage
    );
  }

  const json = (await response.json()) as ApiResponse<T>;
  return json.data;
}

// Type definitions matching OpenAPI schemas

export interface Account {
  id: string;
  email: string;
  name?: string;
  teamId?: string;
  createdAt: string;
}

export interface Instance {
  id: string;
  name: string;
  status: "running" | "stopped" | "starting" | "stopping" | "error";
  created_at: string;
  region?: {
    id: number;
    name: string;
    city: string;
    country: string;
  };
  gpu?: {
    model: string;
    vendor: string;
    vram_gb: string;
    vgpu_count: number;
  };
  instance_type?: {
    id: string;
    name: string;
    cpu_cores: number;
    ram_mb: number;
  };
  ip: string[];
  metadata?: {
    displayName: string | null;
    notes: string | null;
  };
}

export interface Pool {
  id: number | string;
  name: string;
  gpu_model?: string;
  available_gpus?: number;
  price_per_hour?: number;
}

export interface GpuProduct {
  id: string;
  name: string;
  description: string | null;
  pricePerHourCents: number;
  poolIds: number[];
  displayOrder: number;
  featured: boolean;
  badgeText: string | null;
  vramGb: number | null;
  totalAvailableGpus: number;
}

export interface LaunchOptions {
  regions: Array<{ id: string | number; name?: string }>;
  pools: Pool[];
  products: GpuProduct[];
  instanceTypes: Array<{ id: string; name: string; description?: string }>;
  images: Array<{ id: string; name: string; description?: string }>;
  storageBlocks: unknown[];
  ephemeralStorageBlocks: unknown[];
  persistentStorageBlocks: unknown[];
}

export interface InstanceList {
  instances: Instance[];
}

export interface InstanceDetail {
  subscription: {
    id: number | string;
    status: string;
    pool_id?: number | string;
    pool_name?: string;
    gpu_count?: number;
    created_at?: string;
    pods?: Array<{ pod_name: string; pod_status: string }>;
  };
  metadata: {
    displayName: string | null;
    notes: string | null;
  };
  connectionInfo?: ConnectionInfo;
}

export interface ConnectionInfo {
  subscription_id: string;
  pods: Array<{
    pod_name: string;
    pod_status: string;
    internal_ip?: string | null;
    ssh?: {
      command: string;
      password: string;
    } | null;
    discovered_services?: unknown[];
  }>;
}

export interface CreateInstanceResult {
  subscription_id: number | string;
  name: string;
  pool_id: string;
  vgpus: number;
  startup_script_status?: string;
}

export interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface BillingSummary {
  balance: number;
  balanceFormatted: string;
  currentPeriodSpend: number;
  transactions: Array<{
    id: string;
    type: "credit" | "debit";
    amount: number;
    amountFormatted: string;
    description: string;
    createdAt: string;
  }>;
}

export interface TeamMember {
  id: string;
  email: string;
  name?: string;
  role: "owner" | "member";
  invitedAt: string;
  acceptedAt?: string;
  invitedBy: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt?: string;
}
