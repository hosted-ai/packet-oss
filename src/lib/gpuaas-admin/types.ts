/**
 * GPUaaS Admin API Types
 *
 * Types for the admin-console.example.com API used to manage
 * GPU infrastructure for service providers.
 */

// Region types
export interface Region {
  id: number;
  region_name: string;
  address: string;
  city: string;
  country: string;
  country_code: string;
  zipcode: string;
  lat: number;
  lng: number;
  status: {
    gpuaas: "enabled" | "disabled" | "none";
    compute: "enabled" | "disabled" | "none";
  };
  accelerator_type: "gpu" | "npu";
  support_rdma?: "infiniband" | "gpu_direct";
}

export interface CreateRegionInput {
  region_name: string; // Max 12 chars, alphanumeric and hyphens
  address: string;
  city: string;
  country?: string; // Auto-detected for HK/SG
  country_code?: string; // Auto-detected for HK/SG
  zipcode: string;
  lat?: number;
  lng?: number;
  accelerator_type: "gpu" | "npu";
  support_rdma?: "infiniband" | "gpu_direct";
}

// GPUaaS cluster types
export interface GPUaaSCluster {
  id: number;
  created_at: string;
  updated_at: string;
  deleted_at: string;
  region_id: number;
  prometheus_reverse_tunnel_port: number;
  k8s_api_server_port: number;
  status:
    | "GPUAAS_ACTIVE"
    | "GPUAAS_INACTIVE"
    | "GPUAAS_INITIALIZING"
    | "GPUAAS_ENABLE_SETTING_UP"
    | "GPUAAS_ERROR_WHILE_ENABLING"
    | string; // Allow other statuses from API
}

// Node types
export interface GPUaaSNodeGPU {
  id: number;
  gpu_id: string; // Index as string, e.g., "0"
  uuid: string;
  vendor: string;
  gpu_model: string;
  assignment_status: string;
}

export interface GPUaaSNode {
  Id: number;
  name: string;
  region_id: number;
  node_ip: string;
  username: string;
  port: number;
  external_service_ip: string;
  volume_group?: string;
  initialize_state_status_code: number; // 0=not init, 1=in progress, 2=completed, -1=error
  k8s_join_state_status_code?: number; // 0=not joined, 1=in progress, 2=completed, -1=error
  role: {
    is_controller_node: boolean;
    is_worker_node: boolean;
    is_gateway_service: boolean;
    is_storage_service: boolean;
  };
  // GPU info (populated after initialization)
  gpus?: GPUaaSNodeGPU[];
  nvidia_driver_version?: string;
  total_memory_in_mb?: number;
  total_disk_in_mb?: number;
  cores?: number;
  cpu_model?: string;
  // Region info
  region?: {
    region_id: number;
    region_name: string;
    city: string;
    country: string;
    country_code: string;
    is_enabled: boolean;
    accelerator_type: string;
  };
}

export interface AddNodeInput {
  name: string;
  region_id: number;
  node_ip: string;
  username: string;
  port: number;
  external_service_ip?: string; // Optional: only needed for gateway service nodes
  volume_group?: string;
  is_controller_node: boolean;
  is_worker_node: boolean;
  is_gateway_service: boolean;
  is_storage_service: boolean;
}

// Pool types
export interface GPUaaSPool {
  id: number;
  name: string;
  description?: string;
  region_id: number;
  overcommit_ratio: number;
  team_name?: string;
  total_gpus: number;
  available_gpus: number;
  allocated_gpus: number;
  special_mode?: boolean;
  security_mode?: "low" | "medium" | "high";
  created_at: string;
}

export interface CreatePoolInput {
  name: string;
  description?: string;
  region_id?: number; // Deprecated: use gpuaas_id instead
  gpuaas_id?: number; // Cluster ID (required for /gpuaas/pool/create endpoint)
  overcommit_ratio?: number; // 1.0-10.0, default 1.0 (maps to sharing_ratio in API)
  time_quantum_in_sec?: number; // Time quantum in seconds (MUST be 90, API rejects 3600)
  attach_gpu_ids?: string[]; // GPU UUIDs to attach (e.g., "GPU-72883924-9789-83a9-2a01-64d351042646")
  team_name?: string;
  special_mode?: boolean; // Enable special mode for pool
  security_mode?: "low" | "medium" | "high"; // Security level (maps to security_level in API)
}

// GPU addition types
export interface AddGPUToPoolInput {
  pool_id: number;
  gpuaas_node_id: number;
  gpu_index?: number; // Optional: specific GPU index on the node
}

export interface PoolGPU {
  id: number;
  pool_id: number;
  node_id: number;
  gpu_index: number;
  gpu_name: string;
  gpu_memory: number;
  gpu_uuid: string;
  status: "available" | "allocated" | "reserved";
}

// API error response
export interface APIError {
  code: number;
  message: string;
  errors: Array<{ field?: string; message?: string }>;
}

// Login response
export interface LoginResponse {
  id: number;
  username: string;
  email: string;
  role: string;
  is_super_admin: boolean;
  token: string;
  page_access: string[];
}
