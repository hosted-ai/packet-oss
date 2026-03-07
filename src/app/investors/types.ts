export interface NodeMetrics {
  gpuUtilization: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  fanSpeed: number;
  lastMetricAt: string;
}

/** A single subscription (customer pod) running on a node's pool */
export interface NodeSubscription {
  subscriptionId: string;
  teamId: string;
  status: string;
  podStatus?: string;
  isDead: boolean;
  vgpuCount: number;
  podName?: string;
  createdAt?: string;
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  uptimeHoursThisMonth: number;
}

/** A physical GPU node owned by the investor */
export interface InvestorNode {
  nodeId: string;
  hostname: string | null;
  gpuModel: string | null;
  gpuCount: number | null;
  status: string;
  // Capacity
  totalVgpuSlots: number;
  occupiedSlots: number;
  occupancyPercent: number;
  // Revenue for this node
  hourlyRateCents: number;
  monthlyRateCents: number | null;
  billingType: string;
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  revenuePerGpuThisMonthCents: number;
  uptimeHoursThisMonth: number;
  // KPIs
  customerCount: number;
  overcommitRatio: number;
  customersPerGpu: number;
  // Hardware metrics (averaged across subscriptions or from node)
  avgGpuUtilization: number | null;
  avgTemperature: number | null;
  avgMemoryPercent: number | null;
  metrics: NodeMetrics | null;
  // Subscriptions breakdown
  subscriptions: NodeSubscription[];
}

/** Daily revenue data point for historical charts */
export interface DailyRevenue {
  date: string; // YYYY-MM-DD
  grossCents: number;
  investorCents: number;
  customers: number;
}

export interface NodeSummary {
  totalNodes: number;
  activeNodes: number;
  nodesWithPool: number;
  totalPhysicalGpus: number;
  totalVgpuSlots: number;
  totalOccupiedSlots: number;
  totalCustomers: number;
  avgOccupancyPercent: number;
  avgOvercommitRatio: number;
  avgGpuUtilization: number | null;
  avgTemperature: number | null;
  avgMemoryPercent: number | null;
}

export interface RevenueData {
  // Gross revenue (what customers pay)
  grossRevenueThisMonthCents: number;
  grossRevenueLastMonthCents: number;
  grossRevenueDailyRateCents: number;
  grossRevenueProjectedMonthCents: number;
  // Investor share
  revenueSharePercent: number;
  investorRevenueThisMonthCents: number;
  investorRevenueLastMonthCents: number;
  investorRevenueDailyRateCents: number;
  investorRevenueProjectedMonthCents: number;
  // Trends
  monthOverMonthChangePercent: number | null;
  // Fleet utilization (billable hours / total possible hours)
  fleetUtilizationPercent: number;
}

export interface BusinessHealth {
  revenuePerGpuPerDayCents: number;
  arpcCents: number;
  sellThroughPercent: number;
  churnPercent: number | null;
  topCustomerPercent: number | null;
  avgSessionDurationHours: number | null;
}

export interface InvestorDashboardData {
  nodes: InvestorNode[];
  summary: NodeSummary;
  revenue: RevenueData;
  businessHealth: BusinessHealth;
  dailyRevenue: DailyRevenue[];
  lastUpdated: string;
  _cachedAt?: string;
  _nextUpdateAt?: string;
}

export interface Investor {
  email: string;
  addedAt: string;
  isOwner: boolean;
  acceptedAt: string | null;
  lastLoginAt: string | null;
}
