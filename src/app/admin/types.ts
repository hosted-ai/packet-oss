export interface Stats {
  totalCustomers: number;
  activePods: number;
  mrr: number;
  newCustomersThisWeek: number;
  revenueThisWeek: number;
  growth: {
    totalCustomers: number;
    activePods: number;
    mrr: number;
    newCustomersThisWeek: number;
    revenueThisWeek: number;
  } | null;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  created: number;
  teamId: string;
  productId: string;
  billingType: string;
  walletBalance: number; // in cents
  activeGPUs: number;
}

export interface Admin {
  email: string;
  addedAt: string;
  addedBy: string;
}

export interface Investor {
  email: string;
  addedAt: string;
  addedBy: string;
  isOwner?: boolean;
  acceptedAt?: string | null;
  lastLoginAt?: string | null;
  assignedNodeIds?: string[];
  revenueSharePercent?: number | null;
}

export interface TieredPricing {
  month1?: number;
  month3?: number;
  month6?: number;
  month12?: number;
  month24?: number;
  month36?: number;
}

export interface ClusterOffer {
  id: string;
  name: string;
  description: string;
  image?: string;
  gpuType: string;
  gpuCount: number;
  gpuMemory?: string;
  specs: {
    cpu?: string;
    memory?: string;
    storage?: string;
    network?: string;
    ethernet?: string;
    nodeCount?: number;
    totalGpuMemory?: string;
    interconnect?: string;
    platform?: string;
  };
  pricing: TieredPricing;
  location: string;
  region?: string;
  availability: "available" | "limited" | "coming_soon";
  featured: boolean;
  sortOrder: number;
  highlights?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PricingConfig {
  hourlyRateCents: number;
  storagePricePerGBHourCents: number;
  autoRefillThresholdCents: number;
  autoRefillAmountCents: number;
  stoppedInstanceRatePercent: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Quote {
  id: string;
  token: string;
  quoteNumber: string;
  customerName: string;
  customerEmail: string;
  customerCompany?: string;
  customerPhone?: string;
  gpuType: string;
  gpuCount: number;
  gpuMemory?: string;
  specs: {
    cpu?: string;
    memory?: string;
    storage?: string;
    network?: string;
    ethernet?: string;
    nodeCount?: number;
    totalGpuMemory?: string;
    interconnect?: string;
    platform?: string;
  };
  pricing: TieredPricing;
  location: string;
  notes?: string;
  startsAt?: string;
  expiresAt: string;
  status: "pending" | "accepted" | "declined" | "expired" | "converted";
  createdAt: string;
  updatedAt: string;
  customerResponse?: {
    action: "accepted" | "declined" | "question";
    message?: string;
    respondedAt: string;
  };
  reminderSentAt?: string;
}

export interface AdminActivity {
  id: string;
  type: string;
  adminEmail: string;
  description: string;
  metadata?: Record<string, unknown>;
  created: number;
}

export type AdminTab = "customers" | "admins" | "investors" | "clusters" | "quotes" | "referrals" | "vouchers" | "activity" | "settings" | "calculator" | "qa" | "providers" | "landing" | "game" | "products" | "pods" | "emails" | "email-log" | "drip" | "nodes" | "pools" | "business" | "demand" | "batches" | "token-providers" | "skypilot" | "support" | "spheron" | "node-revenue" | "banners" | "marketing" | "tenants" | "pixel-factory" | "uptime" | "payouts" | "platform-settings" | "gpu-apps";

/**
 * Admin tabs that are only available in the Pro edition.
 * In the OSS build these tabs are hidden from the sidebar and their
 * render branches are skipped.
 */
export const PREMIUM_ADMIN_TABS: ReadonlySet<AdminTab> = new Set([
  "clusters",
  "quotes",
  "calculator",
  "demand",
  "batches",
  "token-providers",
  "spheron",
  "pixel-factory",
  "tenants",
  "investors",
  "payouts",
  "node-revenue",
  "game",
  "landing",
  "marketing",
  "qa",
]);

/**
 * Admin tabs that are only available in the OSS (self-hosted) edition.
 * In the Pro build these tabs are hidden from the sidebar and their
 * render branches are skipped.
 */
export const OSS_ONLY_ADMIN_TABS: ReadonlySet<AdminTab> = new Set([
  "platform-settings",
]);

// Infrastructure Request types (demand for GPU supply)
export interface TargetPricing {
  month1?: number;
  month3?: number;
  month6?: number;
  month12?: number;
  month24?: number;
  month36?: number;
}

export interface InfrastructureRequest {
  id: string;
  title: string;
  description: string;
  gpuType: string;
  gpuCountMin: number;
  gpuCountMax?: number;
  gpuMemoryMin?: string;
  nodeCountMin: number;
  nodeCountMax?: number;
  specs: {
    cpuMin?: string;
    memoryMin?: string;
    storageMin?: string;
    networkMin?: string;
    interconnect?: string;
  };
  targetPricing: TargetPricing;
  preferredContractLength: keyof TargetPricing;
  minContractLength: keyof TargetPricing;
  preferredLocations: string[];
  acceptableLocations?: string[];
  neededBy?: string;
  urgency: "low" | "medium" | "high" | "critical";
  status: "active" | "paused" | "fulfilled" | "expired";
  featured: boolean;
  sortOrder: number;
  responseCount: number;
  internalNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InfrastructureRequestFormData {
  title: string;
  description: string;
  gpuType: string;
  gpuCountMin: number;
  gpuCountMax: number | null;
  gpuMemoryMin: string;
  nodeCountMin: number;
  nodeCountMax: number | null;
  specs: {
    cpuMin: string;
    memoryMin: string;
    storageMin: string;
    networkMin: string;
    interconnect: string;
  };
  targetPricing: TargetPricing;
  preferredContractLength: keyof TargetPricing;
  minContractLength: keyof TargetPricing;
  preferredLocations: string[];
  acceptableLocations: string[];
  neededBy: string;
  urgency: "low" | "medium" | "high" | "critical";
  status: "active" | "paused" | "fulfilled" | "expired";
  featured: boolean;
  sortOrder: number;
  internalNotes: string;
}

export const EMPTY_INFRASTRUCTURE_REQUEST_FORM: InfrastructureRequestFormData = {
  title: "",
  description: "",
  gpuType: "",
  gpuCountMin: 8,
  gpuCountMax: null,
  gpuMemoryMin: "",
  nodeCountMin: 1,
  nodeCountMax: null,
  specs: {
    cpuMin: "",
    memoryMin: "",
    storageMin: "",
    networkMin: "",
    interconnect: "",
  },
  targetPricing: {},
  preferredContractLength: "month12",
  minContractLength: "month6",
  preferredLocations: [],
  acceptableLocations: [],
  neededBy: "",
  urgency: "medium",
  status: "active",
  featured: false,
  sortOrder: 0,
  internalNotes: "",
};

// GPU Product types for pricing/product management
export interface GpuProduct {
  id: string;
  name: string;
  description: string | null;
  billingType: "hourly" | "monthly";
  pricePerHourCents: number;
  pricePerMonthCents: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  poolIds: number[];
  serviceId: string | null;
  displayOrder: number;
  active: boolean;
  featured: boolean;
  badgeText: string | null;
  vramGb: number | null;
  cudaCores: number | null;
  createdAt: string;
  updatedAt: string;
}

// GPU Offerings types for landing page carousel
export interface HeroContent {
  pill: string;
  headline: string;
  subhead: string;
  description: string;
  hourlyNote: string;
  monthlyNote: string;
  signals: string[];
}

export interface PricingContent {
  title: string;
  subtitle: string;
  features: string[];
}

export interface GpuOffering {
  id: string;
  name: string;
  fullName: string;
  image: string;
  hourlyPrice: number;
  memory: string;
  hero: HeroContent;
  pricing: PricingContent;
  location: string;
  sortOrder: number;
  active: boolean;
  soldOut?: boolean;
  popular?: boolean;
}

export interface ProofStat {
  label: string;
  value: string;
  note: string;
}

export interface ProofSection {
  stats: ProofStat[];
}

export interface CarouselSettings {
  autoRotateMs: number;
  pauseOnHover: boolean;
}

export interface GpuOfferingsData {
  offerings: GpuOffering[];
  proofSection: ProofSection;
  carouselSettings: CarouselSettings;
}

export interface GpuOfferingFormData {
  name: string;
  fullName: string;
  image: string;
  hourlyPrice: number;
  memory: string;
  hero: HeroContent;
  pricing: PricingContent;
  location: string;
  sortOrder: number;
  active: boolean;
  soldOut: boolean;
  popular: boolean;
}

export const EMPTY_GPU_OFFERING_FORM: GpuOfferingFormData = {
  name: "",
  fullName: "",
  image: "",
  hourlyPrice: 0,
  memory: "",
  hero: {
    pill: "Available now",
    headline: "",
    subhead: "",
    description: "",
    hourlyNote: "",
    monthlyNote: "",
    signals: [],
  },
  pricing: {
    title: "",
    subtitle: "",
    features: [],
  },
  location: "",
  sortOrder: 0,
  active: true,
  soldOut: false,
  popular: false,
};

// Provider types for admin management
export interface ProviderSummary {
  id: string;
  companyName: string;
  email: string;
  contactName: string;
  applicationType?: string;
  status: string;
  totalNodes: number;
  activeNodes: number;
  totalGpus: number;
  createdAt: string;
  verified: boolean;
}

export interface ProviderNode {
  id: string;
  providerId: string;
  hostname: string | null;
  ipAddress: string;
  sshPort: number | null;
  sshUsername: string | null;
  sshPassword: string | null;
  status: string;
  statusMessage: string | null;
  gpuModel: string | null;
  gpuCount: number | null;
  validatedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  // GPUaaS provisioning fields
  gpuaasNodeId?: number | null;
  gpuaasRegionId?: number | null;
  gpuaasClusterId?: number | null;
  gpuaasPoolId?: number | null;
  gpuaasInitStatus?: string | null;
  gpuaasSshKeysInstalled?: boolean;
  externalServiceIp?: string | null;
  provider?: {
    id: string;
    companyName: string;
    email: string;
  };
  pricingTier?: {
    id: string;
    name: string;
    providerRateCents: number;
    customerRateCents: number;
    isRevenueShare: boolean;
    revenueSharePercent: number | null;
  } | null;
  customProviderRateCents?: number | null;
  revenueSharePercent?: number | null;
  requestedGpuTypeId?: string | null;
  requestedGpuType?: {
    id: string;
    name: string;
    shortName: string;
    defaultProviderRateCents: number;
    defaultCustomerRateCents: number;
    defaultTermsType: string;
    defaultRevenueSharePercent: number | null;
  } | null;
}

export interface PricingTier {
  id: string;
  name: string;
  gpuModel: string;
  providerRateCents: number;
  customerRateCents: number;
  isRevenueShare: boolean;
  revenueSharePercent: number | null;
}

export interface GpuType {
  id: string;
  name: string;
  shortName: string;
  manufacturer: string;
  matchPatterns: string[];
  defaultProviderRateCents: number;
  defaultCustomerRateCents: number;
  defaultTermsType: string;
  defaultRevenueSharePercent: number | null;
  payoutModelChoice: string;
  acceptingSubmissions: boolean;
  displayOrder: number;
  minVramGb: number | null;
}

export interface ClusterFormData {
  name: string;
  description: string;
  image: string;
  gpuType: string;
  gpuCount: number;
  gpuMemory: string;
  specs: {
    cpu: string;
    memory: string;
    storage: string;
    network: string;
    ethernet: string;
    interconnect: string;
    platform: string;
    nodeCount?: number;
  };
  pricing: TieredPricing;
  location: string;
  region: string;
  availability: "available" | "limited" | "coming_soon";
  featured: boolean;
  sortOrder: number;
  highlights: string[];
}

export interface QuoteFormData {
  customerName: string;
  customerEmail: string;
  customerCompany: string;
  customerPhone: string;
  gpuType: string;
  gpuCount: number;
  gpuMemory: string;
  specs: {
    cpu: string;
    memory: string;
    storage: string;
    network: string;
    ethernet: string;
    interconnect: string;
    platform: string;
    nodeCount: number;
  };
  pricing: TieredPricing;
  location: string;
  notes: string;
  startsAt: string;
  expiresAt: string;
  sendEmail: boolean;
}

export interface EmailPreview {
  to: string;
  subject: string;
  html: string;
  quoteUrl: string;
}

export const EMPTY_QUOTE_FORM: QuoteFormData = {
  customerName: "",
  customerEmail: "",
  customerCompany: "",
  customerPhone: "",
  gpuType: "",
  gpuCount: 1,
  gpuMemory: "",
  specs: {
    cpu: "",
    memory: "",
    storage: "",
    network: "",
    ethernet: "",
    interconnect: "",
    platform: "",
    nodeCount: 1,
  },
  pricing: {},
  location: "",
  notes: "",
  startsAt: "",
  expiresAt: "",
  sendEmail: true,
};

export const EMPTY_CLUSTER_FORM: ClusterFormData = {
  name: "",
  description: "",
  image: "",
  gpuType: "",
  gpuCount: 1,
  gpuMemory: "",
  specs: {
    cpu: "",
    memory: "",
    storage: "",
    network: "",
    ethernet: "",
    interconnect: "",
    platform: "",
  },
  pricing: {},
  location: "",
  region: "",
  availability: "available",
  featured: false,
  sortOrder: 0,
  highlights: [],
};

// Pool Settings types
export interface PoolSettingsDefaults {
  timeQuantumSec: number;
  overcommitRatio: number;
  securityMode: "low" | "medium" | "high";
  updatedAt?: string;
  updatedBy?: string;
}

export interface PoolSettingsOverride {
  id: string;
  gpuaasPoolId: number;
  poolName: string | null;
  timeQuantumSec: number | null;
  overcommitRatio: number | null;
  securityMode: string | null;
  priority: number | null;
  maintenance: boolean;
  notes: string | null;
  node: {
    id: string;
    hostname: string;
    gpuModel: string | null;
    ipAddress: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface AvailablePool {
  id: number;
  name: string;
  regionId: number;
  gpuModel?: string;
  totalGpus?: number;
  hasOverride: boolean;
}
