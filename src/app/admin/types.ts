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

export interface PricingConfig {
  hourlyRateCents: number;
  storagePricePerGBHourCents: number;
  autoRefillThresholdCents: number;
  autoRefillAmountCents: number;
  stoppedInstanceRatePercent: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AdminActivity {
  id: string;
  type: string;
  adminEmail: string;
  description: string;
  metadata?: Record<string, unknown>;
  created: number;
}

export type AdminTab = "platform-settings" | "customers" | "admins" | "investors" | "referrals" | "vouchers" | "activity" | "settings" | "qa" | "providers" | "landing" | "game" | "products" | "pods" | "emails" | "drip" | "nodes" | "pools" | "business" | "skypilot" | "support" | "node-revenue" | "banners" | "marketing" | "uptime" | "payouts";

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
