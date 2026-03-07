/**
 * Type definitions for hosted.ai API
 */

// Default policy IDs from the console.example.com instance
export const DEFAULT_POLICIES = {
  pricing: "582592e0-fb6b-4ca2-903f-dd1d88278c59", // Default Policy - Zero Cost
  resource: "06cf8cc7-6b89-4302-8107-fb22c3f15e2e", // UK Resource Policy
  service: "4dbfdae0-13b7-45f6-a9c9-a533a3a8ff87", // Default Service Policy
  instanceType: "6374e27b-b7c5-4fae-9371-390f1175ca8f", // Default Instance Type Policy
  image: "8c4fe149-7ea6-4507-bd6b-3d6a12465152", // Default Image Policy
};

export const ROLES = {
  teamAdmin: "1cd64174-ff8c-4054-97ad-a799fe1740ab",
  teamMember: "43c25fe2-e9c1-47fb-b2d5-8b23ca1facbd",
};

// ============================================
// Team Types
// ============================================

export interface Team {
  id: string;
  name: string;
  description?: string;
}

export interface OTLResponse {
  url: string;
  expires_at: string;
  should_onboard: boolean;
  two_fa_required: boolean;
}

export interface CreateTeamParams {
  name: string;
  description?: string;
  color?: string;
  members: Array<{
    email: string;
    name?: string;
    role: string; // role ID (team_admin or team_member) - API uses 'role' not 'role_id'
    send_email_invite?: boolean; // Whether to send invite email (default: false)
    password?: string; // Password for pre-onboarding the user
    pre_onboard?: boolean; // Whether to pre-onboard the user (skip onboarding form)
  }>;
  pricing_policy_id: string;
  resource_policy_id: string;
  service_policy_id: string;
  instance_type_policy_id: string;
  image_policy_id: string;
}

// ============================================
// Billing Types
// ============================================

export interface TeamBillingData {
  result?: string;
  errors?: string[];
  total_cost?: number;
  total_hours?: number;
  currency?: string;
  instances?: Array<{
    instance_id: string;
    instance_name: string;
    hours: number;
    cost: number;
  }>;
  // Allow any additional fields from API
  [key: string]: unknown;
}

export interface GPUaaSSummaryItem {
  pool_name?: string;
  gpu_card_name?: string;
  pool_hours?: number;
  total?: string | number;
  subscription_rate?: string | number;
}

export interface SharedStorageBillingSummaryItem {
  storage_name?: string;
  cost?: string | number;
  hours?: number;
}

export interface BillingSummaryResponse {
  total_cost?: string | number;
  monthly_base_cost?: string | number;
  total_hours?: number;
  pool_hours?: number;
  instance_hours?: number;
  gpuaas_summary?: GPUaaSSummaryItem[];
  shared_storage_billing_summary?: SharedStorageBillingSummaryItem[];
  instance_billing_summary?: Array<{
    instance_name?: string;
    hours?: number;
    cost?: number;
  }>;
  currency?: {
    code?: string;
    symbol?: string;
  };
  // Allow any additional fields
  [key: string]: unknown;
}

// ============================================
// Instance Types
// ============================================

export interface ServiceScenario {
  id: string;
  name: string;
  description?: string;
  services?: number[];
  tags?: string[];
}

export interface CompatibleScenariosResponse {
  scenarios: ServiceScenario[];
  images: Record<string, { name: string; description?: string }>;
}

export interface InstanceType {
  id: string;
  name: string;
  description?: string;
  cpu_cores?: number;
  ram_gb?: number;
  gpu_count?: number;
  gpu_model?: string;
  price_per_hour?: number;
}

export interface Image {
  id: string;
  name: string;
  description?: string;
  os?: string;
}

export interface ImagePolicyObject {
  id: string;
  name: string;
  gpu_workload_image?: boolean;
  description?: string;
}

export interface ImagePolicy {
  id: string;
  name: string;
  description?: string;
  is_default?: boolean;
  is_system_defined?: boolean;
  objects: ImagePolicyObject[] | null;
  teams?: Array<{ id: string; name: string }>;
  type: string;
}

export interface StorageBlock {
  id: string;
  name: string;
  size_gb?: number;
  size_in_gb?: number; // Alternative field name from API
  type?: string;
  price_per_hour?: number;
  shared_storage_usage?: boolean; // Whether block is for shared/persistent storage
  is_available?: boolean;
}

export interface Instance {
  id: string;
  name: string;
  status: string;
  instance_type?: InstanceType;
  image?: Image;
  created_at?: string;
  ip_address?: string;
}

export interface CreateInstanceParams {
  name: string;
  service_id: string;
  instance_type_id: string;
  image_hash_id: string;
  storage_block_id: string;
  team_id: string;
  workspace_id?: string;
  network_assignment?: string;
  additional_disks?: Array<{ storage_block_id: string; disk_position: number }>;
}

export interface VNCSession {
  url?: string;
  token?: string;
  websocket_url?: string;
  expires_at?: string;
}

// ============================================
// GPU Pool Types
// ============================================

export interface GPURegion {
  id: string | number;
  name?: string;
  region_name?: string;
  location?: string;
  city?: string;
  country?: string;
  available_pools?: number;
  gpuaas_id?: number;
}

export interface GPUPool {
  id: string;
  name: string;
  gpu_model?: string;
  available_gpus?: number;
  price_per_hour?: number;
}

export interface GPUPoolExtended extends GPUPool {
  gpuaas_id?: number;
  region_id?: number;
}

export interface PoolSubscription {
  id: string;
  pool_id: string;
  team_id?: string;
  pool_name?: string;
  gpu_count?: number;
  status: string;
  region?: {
    region_name?: string;
    city?: string;
  };
  storage_details?: {
    ephemeral_storage_gb?: number;
    persistent_storage_gb?: number; // Present when persistent storage is attached
    persistent_storage_block_id?: string;
    shared_volumes?: Array<{
      id?: string;
      name?: string;
      size_gb?: number;
      size_in_gb?: number; // Alternative field name from API
    }> | null;
  };
  pods?: Array<{
    pod_name: string;
    pod_status: string;
    gpu_count: number;
    services?: Array<{
      name: string;
      type: string;
      port?: number;
      ip?: string;
      credentials?: {
        username?: string;
        password?: string;
      };
    }>;
  }>;
  per_pod_info?: {
    image_name?: string;
    image_uuid?: string;
    vgpu_count?: number;
    vcpu_count?: number;
    ram_mb?: number;
  };
}

export interface PoolSubscriptionResponse {
  items: PoolSubscription[];
  page: number;
  per_page: number;
  total_items: number;
  total_pages: number;
}

export type MetricWindow = "last_5m" | "last_15m" | "last_1h" | "last_24h" | "last_7d" | "all_time";

export interface CalculatePoolSubscriptionParams {
  pool_id: string | number;
  gpu_count: number;
  duration_hours?: number;
  team_id: string;
}

export interface PoolSubscriptionCostEstimate {
  total_cost: number;
  hourly_cost: number;
  currency: string;
  breakdown?: {
    gpu_cost: number;
    storage_cost: number;
  };
}

export interface SubscribePoolParams {
  pool_id: string;
  team_id: string;
  vgpus?: number;
  instance_type_id: string;
  ephemeral_storage_block_id?: string;
  persistent_storage_block_id?: string;
  shared_volumes?: number[]; // Array of shared volume IDs
  image_uuid?: string;
}

// Shared volume creation params
export interface CreateSharedVolumeParams {
  team_id: string;
  region_id: number;
  name: string;
  storage_block_id: string;
}

// Shared volume response
export interface SharedVolume {
  id: number;
  name: string;
  region_id: number;
  team_id: string;
  size_in_gb: number;
  mount_point: string;
  cost: string | number;
  status: string;
}

// Raw pool response from API
export interface RawGPUPool {
  pool_id: number;
  pool_name: string;
  gpuaas_id?: number;
  cluster_id?: number;
  city?: string;
  region_name?: string;
  region_id?: number;
  country_code?: string;
}

// ============================================
// Connection Info Types
// ============================================

export interface PodConnectionInfo {
  pod_name: string;
  pod_status: string;
  ssh_info?: {
    cmd: string;
    pass: string;
  };
  discovered_services?: Array<{
    name: string;
    url?: string;
  }>;
  internal_ip?: string; // Internal/private IP fetched via SSH
}

export interface SubscriptionConnectionInfo {
  id: number;
  pool_name: string;
  region_id: number;
  pods: PodConnectionInfo[];
}

export type PodAction = "start" | "stop" | "restart";

// ============================================
// Metrics Types
// ============================================

export interface GPUaaSMetric {
  id?: string;
  subscription_id?: number;
  pool_name?: string;
  gpu_count?: number;
  hours_used?: number;
  cost?: number;
  start_time?: string;
  end_time?: string;
  status?: string;
}

export interface GPUaaSMetricsResponse {
  items?: GPUaaSMetric[];
  metrics?: GPUaaSMetric[];
  total_hours?: number;
  total_cost?: number;
  page?: number;
  per_page?: number;
  total_items?: number;
  total_pages?: number;
}

export interface GPUaaSGraphDataPoint {
  timestamp?: string;
  value?: number;
  tflops?: number;
  hours?: number;
}

export interface GPUaaSMetricsGraphResponse {
  data?: GPUaaSGraphDataPoint[];
  granularity?: string;
  total_tflops?: number;
  total_hours?: number;
}

// ============================================
// Service Exposure Types
// ============================================

export interface PodExposeServiceOpts {
  pod_name: string;
  pool_subscription_id?: number;
  port: number;
  service_name: string;
  protocol: "TCP" | "UDP";
  // For TCP: "http", "https", or "NodePort" (raw TCP without http prefix)
  // For UDP: "NodePort" or "loadbalancer" (Kubernetes types)
  service_type: "http" | "https" | "NodePort" | "loadbalancer";
}

export interface PodDiscoveredServices {
  id: number;
  pod_name: string;
  team_id: string;
  service_name: string;
  ip: string;
  node_port: number;
  pod_port: number;
  protocol: string;
  status: string;
  service_type: string;
  created_at?: string;
}

export interface PodUpdateExposedServiceOpts {
  id: number;
  service_name?: string;
  port?: number;
  protocol?: "TCP" | "UDP";
  service_type?: "http" | "https" | "NodePort" | "loadbalancer";
}

export interface ExposeServiceStatusResponse {
  status: string;
  message: string;
  service_name: string;
  pod_name: string;
  namespace: string;
  node: string;
  service_ip: string;
  node_port: number;
  pod_port: number;
  protocol: string;
  service_type: string;
  service_file?: string;
  service_exists: boolean;
  kubernetes_active: boolean;
}

export interface ExposedServiceInfo {
  id: number;
  service_name: string;
  ip: string;
  internal_port: number;
  external_port: number;
  protocol: string;
  type: string;
  status: string;
  created_at: string;
}
