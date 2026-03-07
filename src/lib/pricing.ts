import fs from "fs";
import path from "path";

const PRICING_FILE = path.join(process.cwd(), "data", "pricing.json");

export interface PricingConfig {
  // DEPRECATED: hourlyRateCents - GPU rates now come from GpuProduct model (per-product pricing)
  // Kept for backwards compatibility but not used in billing
  hourlyRateCents: number;
  storagePricePerGBHourCents: number; // Storage rate per GB per hour in cents (e.g., 0.01 = $0.0001/GB/hr)
  autoRefillThresholdCents: number; // Trigger refill when below this
  autoRefillAmountCents: number; // Amount to refill
  stoppedInstanceRatePercent: number; // Percentage of hourly rate charged for stopped/reserved instances (default 25%)
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULT_PRICING: PricingConfig = {
  hourlyRateCents: 0, // DEPRECATED - GPU rates come from GpuProduct.pricePerHourCents
  storagePricePerGBHourCents: 0, // Configurable via admin Settings tab. Default 0 = no storage charges.
  autoRefillThresholdCents: 2500, // $25 - Configurable via admin Settings tab
  autoRefillAmountCents: 10000, // $100 - Configurable via admin Settings tab
  stoppedInstanceRatePercent: 25, // 25% of hourly rate for stopped instances
};

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export function getPricing(): PricingConfig {
  try {
    if (!fs.existsSync(PRICING_FILE)) {
      // Return defaults if file doesn't exist
      return DEFAULT_PRICING;
    }
    const data = fs.readFileSync(PRICING_FILE, "utf-8");
    const parsed = JSON.parse(data);
    // Merge with defaults to ensure all fields exist
    return { ...DEFAULT_PRICING, ...parsed };
  } catch (error) {
    console.error(`Failed to read pricing file: ${error}`);
    return DEFAULT_PRICING;
  }
}

export function updatePricing(
  config: Partial<PricingConfig>,
  updatedBy: string
): PricingConfig {
  ensureDataDir();

  const current = getPricing();
  const updated: PricingConfig = {
    ...current,
    ...config,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  fs.writeFileSync(PRICING_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * @deprecated GPU hourly rates now come from GpuProduct model (per-product pricing)
 * This function is kept for backwards compatibility but should not be used.
 * Use PodMetadata.hourlyRateCents instead (set at deploy time from GpuProduct.pricePerHourCents)
 */
export function getHourlyRateCents(): number {
  console.warn("[DEPRECATED] getHourlyRateCents() called - GPU rates should come from GpuProduct model");
  return getPricing().hourlyRateCents;
}

// Get auto-refill threshold in cents
export function getAutoRefillThresholdCents(): number {
  return getPricing().autoRefillThresholdCents;
}

// Get auto-refill amount in cents
export function getAutoRefillAmountCents(): number {
  return getPricing().autoRefillAmountCents;
}

// Get storage price per GB per hour in cents
export function getStoragePricePerGBHourCents(): number {
  return getPricing().storagePricePerGBHourCents;
}

// Get stopped instance rate as percentage (e.g., 25 = 25%)
export function getStoppedInstanceRatePercent(): number {
  return getPricing().stoppedInstanceRatePercent;
}
