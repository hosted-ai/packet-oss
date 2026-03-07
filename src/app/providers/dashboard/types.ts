export type ProviderTab = "infrastructure" | "rates" | "revenue" | "payouts" | "settings" | "docs";

export interface ProviderProfile {
  id: string;
  email: string;
  companyName: string;
  contactName: string;
  phone: string | null;
  website: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  commercialEmail: string | null;
  commercialPhone: string | null;
  generalEmail: string | null;
  status: string;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export interface ProviderNode {
  id: string;
  hostname: string;
  ipAddress: string;
  sshPort: number;
  gpuModel: string | null;
  gpuCount: number | null;
  cpuModel: string | null;
  cpuCores: number | null;
  ramGb: number | null;
  storageGb: number | null;
  osVersion: string | null;
  datacenter: string | null;
  region: string | null;
  country: string | null;
  status: string;
  statusMessage: string | null;
  healthStatus: string | null;
  lastHealthCheck: string | null;
  validatedAt: string | null;
  validationError: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  removalRequestedAt: string | null;
  removalScheduledFor: string | null;
  removalReason: string | null;
  createdAt: string;
  // GPUaaS provisioning status
  gpuaasNodeId: number | null;
  gpuaasRegionId: number | null;
  gpuaasPoolId: number | null;
  gpuaasInitStatus: string | null; // not_init | in_progress | completed | error
  gpuaasSshKeysInstalled: boolean;
  pricing: {
    tierName: string;
    providerRateCents: number;
    customerRateCents?: number;
    isRevenueShare: boolean;
    revenueSharePercent?: number | null;
  } | null;
}

// Provisioning step for progress display
export interface ProvisioningStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "error";
}

// Helper to calculate provisioning steps for a node
export function getProvisioningSteps(node: ProviderNode): ProvisioningStep[] {
  const steps: ProvisioningStep[] = [];

  // Step 1: SSH Keys
  steps.push({
    id: "ssh_keys",
    label: "Installing SSH keys",
    status: node.gpuaasSshKeysInstalled ? "completed" : node.gpuaasNodeId ? "in_progress" : "pending",
  });

  // Step 2: Node Initialization
  const initStatus = node.gpuaasInitStatus;
  let nodeInitStatus: ProvisioningStep["status"] = "pending";
  if (initStatus === "completed") nodeInitStatus = "completed";
  else if (initStatus === "in_progress") nodeInitStatus = "in_progress";
  else if (initStatus === "error") nodeInitStatus = "error";
  else if (node.gpuaasSshKeysInstalled) nodeInitStatus = "in_progress";

  steps.push({
    id: "node_init",
    label: "Initializing node",
    status: nodeInitStatus,
  });

  // Step 3: Pool Creation
  steps.push({
    id: "pool_creation",
    label: "Creating GPU pool",
    status: node.gpuaasPoolId ? "completed" : initStatus === "completed" ? "in_progress" : "pending",
  });

  // Step 4: Ready
  steps.push({
    id: "ready",
    label: "Ready for customers",
    status: node.gpuaasPoolId && node.status === "active" ? "completed" : "pending",
  });

  return steps;
}

// Helper to check if node is fully provisioned
// Auto-provisioning was removed - nodes are provisioned manually by admin
// So any active node is considered fully provisioned
export function isNodeFullyProvisioned(node: ProviderNode): boolean {
  // If node is active, it's provisioned (manual process)
  if (node.status === "active") return true;
  // Legacy check for any GPUaaS-provisioned nodes
  return !!(
    node.gpuaasNodeId &&
    node.gpuaasPoolId &&
    node.gpuaasInitStatus === "completed" &&
    node.gpuaasSshKeysInstalled
  );
}

export interface ProviderStats {
  totalNodes: number;
  activeNodes: number;
  pendingNodes: number;
  totalGpus: number;
  activeGpus: number;
  utilizationPercent: number;
  thisMonthEarnings: number;
  lastMonthEarnings: number;
}

export interface RevenueSummary {
  period: string;
  startDate: string;
  endDate: string;
  summary: {
    totalHours: number;
    occupiedHours: number;
    utilizationPercent: string;
    customerRevenue: number;
    providerEarnings: number;
    packetMargin: number;
    avgRevenuePerOccupiedHour: number;
  };
  currentMonth: {
    estimatedPayout: number;
    payoutDate: string;
  };
  dailyRevenue: Array<{
    date: string;
    revenue: number;
  }>;
  revenueByNode: Array<{
    nodeId: string;
    hostname: string;
    gpuModel: string | null;
    gpuCount: number | null;
    totalHours: number;
    occupiedHours: number;
    utilizationPercent: string;
    earnings: number;
  }>;
  activeNodes: number;
  totalNodes: number;
  totalGpus: number;
}

export interface Payout {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossEarnings: number;
  deductions: number;
  netPayout: number;
  status: string;
  paidAt: string | null;
  transactionRef: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  failureReason: string | null;
  breakdown: Record<string, unknown> | null;
}

export interface PayoutSummary {
  payouts: Payout[];
  summary: {
    totalGrossEarnings: number;
    totalDeductions: number;
    totalNetPayout: number;
    totalPaid: number;
    totalPending: number;
    payoutCount: number;
    paidCount: number;
  };
  currentPeriod: {
    periodStart: string;
    periodEnd: string;
    estimatedPayout: number;
    payoutDate: string;
    status: string;
  };
}

export interface NodeFormData {
  ipAddress: string;
  sshPort: string;
  sshUsername: string;
  sshPassword: string;
  hostname: string;
  datacenter: string;
  region: string;
  country: string;
  gpuModel: string;
  gpuCount: string;
}

export interface GpuType {
  id: string;
  name: string;
  shortName: string;
  manufacturer: string;
  providerRate: {
    cents: number;
    formatted: string;
  };
  customerRate: {
    cents: number;
    formatted: string;
  };
  termsType: string;
  revenueSharePercent: number | null;
  minVramGb: number | null;
  estimatedMonthly: {
    at100: string;
    at80: string;
    at60: string;
  };
}
