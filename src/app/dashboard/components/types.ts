/**
 * Shared types for dashboard components
 */

export interface AccountData {
  customer: {
    id: string;
    email: string;
    name: string | null;
    billingType: string;
    teamId: string;
    created: number;
  };
  wallet: {
    balance: number;
    balanceFormatted: string;
    currency: string;
  } | null;
  transactions: Array<{
    id: string;
    amount: number;
    amountFormatted: string;
    description: string;
    created: number;
    type: "credit" | "debit";
  }>;
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
  } | null;
  subscriptions: Array<{
    id: string;
    status: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
    productId: string | null;
    productName: string | null;
    poolIds: string[];
    pricePerMonthCents: number | null;
    stripePriceId: string | null;
  }>;
  recentPayments: Array<{
    id: string;
    amount: number;
    amountFormatted: string;
    created: number;
    description: string;
    invoicePdf: string | null;
  }>;
  gpuDashboardUrl: string | null;
  billingPortalUrl: string;
  isOwner: boolean;
  userEmail: string;
  twoFactor: {
    enabled: boolean;
    hasBackupCodes: boolean;
  };
}

export interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  created: number;
}

export interface BillingStats {
  totalCost: number;
  gpuHours: number;
  storageCost?: number;
  storageHours?: number;
  storageVolumes?: Array<{
    name: string;
    hours: number;
    cost: number;
  }>;
  instances: Array<{
    instance_id: string;
    instance_name: string;
    hours: number;
    cost: number;
  }>;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface Instance {
  id: string;
  name: string;
  status: string;
  instance_type?: {
    name: string;
    gpu_model?: string;
  };
  created_at?: string;
  ip_address?: string;
}

export interface PoolSubscription {
  id: string;
  pool_id?: number;
  pool_name?: string;
  status: string;
  region?: {
    region_name?: string;
    city?: string;
  };
  // Hourly rate in dollars (e.g., 0.66 for $0.66/hr) - from GpuProduct pricing
  hourlyRate?: number;
  storage_details?: {
    ephemeral_storage_gb?: number;
    persistent_storage_block_id?: string;
    persistent_storage_gb?: number;
    shared_volumes?: Array<{
      name: string;
      mount_point: string;
      size_in_gb: number;
    }>;
  };
  metrics?: {
    vram_usage?: number;
    tflops_usage?: number;
    pool_hours?: number;
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
    discovered_services?: Array<{
      name: string;
      url?: string;
    }>;
  }>;
  per_pod_info?: {
    image_name?: string;
    image_uuid?: string;
    vgpu_count?: number;
    vcpu_count?: number;
    ram_mb?: number;
  };
  created_at?: string;
}

export interface GpuProduct {
  id: string;
  name: string;
  description: string | null;
  pricePerHourCents: number;
  pricePerMonthCents: number | null;
  billingType: string;
  stripePriceId: string | null;
  poolIds: number[];
  displayOrder: number;
  active: boolean;
  featured: boolean;
  badgeText: string | null;
  vramGb: number | null;
  availablePools: Array<{
    id: string;
    name: string;
    gpu_model?: string;
    available_gpus?: number;
    price_per_hour?: number;
  }>;
  totalAvailableGpus: number;
  totalVgpuSlots?: number;
  occupiedVgpuSlots?: number;
}

export interface LaunchOptions {
  regions: Array<{
    id: string;
    name: string;
    location?: string;
  }>;
  pools: Array<{
    id: string;
    name: string;
    gpu_model?: string;
    available_gpus?: number;
    price_per_hour?: number;
  }>;
  products: GpuProduct[]; // GPU products with pricing and assigned pools
  instanceTypes: Array<{
    id: string;
    name: string;
    description?: string;
    memory_mb?: number;
    vcpus?: number;
    gpu_model?: string;
    gpu_count?: number;
    ram_gb?: number;
  }>;
  images: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  storageBlocks: Array<{
    id: string;
    name: string;
    size_gb?: number;
  }>;
  ephemeralStorageBlocks: Array<{
    id: string;
    name: string;
    size_gb?: number;
  }>;
  persistentStorageBlocks: Array<{
    id: string;
    name: string;
    size_gb?: number;
  }>;
  existingSharedVolumes?: Array<{
    id: number;
    name: string;
    size_in_gb: number;
    region_id: number;
    status: string;
    mount_point: string;
    cost: string | number;
  }>;
  teamId: string;
  selectedRegionId?: string;
  existingPoolIds?: string[]; // Pool IDs where user already has active subscriptions
  walletBalanceCents?: number; // Wallet balance in cents for prepaid check
}

export interface ChartDataPoint {
  date: string;
  fullDate: string;
  spend: number;
  hours: number;
}

export interface ConnectionInfo {
  id: number;
  pool_name: string;
  pods: Array<{
    pod_name: string;
    pod_status: string;
    ssh_info?: {
      cmd: string;
      pass: string;
    };
    internal_ip?: string;
  }>;
}

export interface HfDeploymentInfo {
  id: string;
  hfItemId: string;
  hfItemName: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  netdata?: boolean;
  netdataPort?: number | null;
  openWebUI?: boolean;
  webUiPort?: number | null;
}

export interface GPUMetric {
  id?: string;
  subscription_id?: number;
  pool_name?: string;
  gpu_count?: number;
  hours_used?: number;
  cost?: number;
  start_time?: string;
  end_time?: string;
}

// GPU colors for multi-GPU chart
export const GPU_COLORS = [
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

// Pod Snapshot - saved pod configuration for restore
export interface PodSnapshot {
  id: string;
  displayName: string;
  notes: string | null;
  snapshotType: "template" | "full";
  poolId: string;
  poolName: string | null;
  vgpus: number;
  hasStorage: boolean;
  storage: {
    id: number;
    name: string | null;
    sizeGb: number | null;
  } | null;
  hfModel: {
    id: string;
    name: string | null;
    type: string | null;
    deployScript: string | null;
  } | null;
  autoPreserved: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
