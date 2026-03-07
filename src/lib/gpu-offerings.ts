import fs from "fs";
import path from "path";

const GPU_OFFERINGS_FILE = path.join(process.cwd(), "data", "gpu-offerings.json");

// Hero section content for carousel
export interface HeroContent {
  pill: string; // e.g., "Available now", "Best value"
  headline: string; // e.g., "NVIDIA B200s"
  subhead: string; // e.g., "$2.25/hour, on demand."
  description: string; // Full description text
  hourlyNote: string; // e.g., "$2.25/hour per GPU, $50 minimum deposit"
  monthlyNote: string; // e.g., "$1,642.50/month flat rate (730 hours included)"
  signals: string[]; // e.g., ["Real B200 hardware", "Full performance", "No contracts"]
}

// Pricing card content
export interface PricingContent {
  title: string; // e.g., "B200"
  subtitle: string; // e.g., "192GB HBM3e"
  features: string[]; // Feature bullet points
}

// GPU Offering for landing page carousel
export interface GpuOffering {
  id: string; // e.g., "b200", "h200", "rtx6000"
  name: string; // Short name: "B200", "H200", "RTX 6000 Pro"
  fullName: string; // Full display name: "NVIDIA B200s"
  image: string; // Image path: "/clusters/b200.jpeg"
  hourlyPrice: number; // Per-GPU hourly price
  memory: string; // e.g., "192GB HBM3e"
  hero: HeroContent;
  pricing: PricingContent;
  location: string; // e.g., "US", "US East"
  sortOrder: number;
  active: boolean;
  soldOut?: boolean;
  popular?: boolean;
}

// Proof section stat
export interface ProofStat {
  label: string;
  value: string;
  note: string;
}

// Proof section content
export interface ProofSection {
  stats: ProofStat[];
}

// Carousel settings
export interface CarouselSettings {
  autoRotateMs: number; // Milliseconds between auto-rotations
  pauseOnHover: boolean;
}

// Full GPU offerings data structure
export interface GpuOfferingsData {
  offerings: GpuOffering[];
  proofSection: ProofSection;
  carouselSettings: CarouselSettings;
}

// Default data if file doesn't exist
const DEFAULT_DATA: GpuOfferingsData = {
  offerings: [],
  proofSection: {
    stats: [
      { label: "Live capacity", value: "500+", note: "GPUs across multiple types" },
      { label: "Avg. deploy time", value: "<5 min", note: "From signup to SSH" },
      { label: "Uptime SLA", value: "99.9%", note: "Enterprise reliability" },
      { label: "Support", value: "24/7", note: "Real humans, fast response" },
    ],
  },
  carouselSettings: {
    autoRotateMs: 5000,
    pauseOnHover: true,
  },
};

function readData(): GpuOfferingsData {
  try {
    if (!fs.existsSync(GPU_OFFERINGS_FILE)) {
      return DEFAULT_DATA;
    }
    const data = fs.readFileSync(GPU_OFFERINGS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Failed to read gpu offerings file: ${error}`);
    return DEFAULT_DATA;
  }
}

function writeData(data: GpuOfferingsData): void {
  const dir = path.dirname(GPU_OFFERINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(GPU_OFFERINGS_FILE, JSON.stringify(data, null, 2));
}

// Get all GPU offerings sorted by sortOrder
export function getGpuOfferings(): GpuOffering[] {
  const data = readData();
  return data.offerings.sort((a, b) => a.sortOrder - b.sortOrder);
}

// Get only active GPU offerings (for public display)
export function getActiveGpuOfferings(): GpuOffering[] {
  return getGpuOfferings().filter((o) => o.active);
}

// Get a single GPU offering by ID
export function getGpuOfferingById(id: string): GpuOffering | null {
  const offerings = getGpuOfferings();
  return offerings.find((o) => o.id === id) || null;
}

// Get proof section data
export function getProofSection(): ProofSection {
  const data = readData();
  return data.proofSection;
}

// Get carousel settings
export function getCarouselSettings(): CarouselSettings {
  const data = readData();
  return data.carouselSettings;
}

// Get full data (for admin)
export function getGpuOfferingsData(): GpuOfferingsData {
  return readData();
}

// Create a new GPU offering
export function createGpuOffering(
  offering: Omit<GpuOffering, "id">
): GpuOffering {
  const data = readData();

  // Generate ID from name
  const id = offering.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  const newOffering: GpuOffering = {
    ...offering,
    id,
  };

  data.offerings.push(newOffering);
  writeData(data);

  return newOffering;
}

// Update an existing GPU offering
export function updateGpuOffering(
  id: string,
  updates: Partial<Omit<GpuOffering, "id">>
): GpuOffering | null {
  const data = readData();
  const index = data.offerings.findIndex((o) => o.id === id);

  if (index === -1) {
    return null;
  }

  data.offerings[index] = {
    ...data.offerings[index],
    ...updates,
  };

  writeData(data);
  return data.offerings[index];
}

// Delete a GPU offering
export function deleteGpuOffering(id: string): boolean {
  const data = readData();
  const initialLength = data.offerings.length;

  data.offerings = data.offerings.filter((o) => o.id !== id);

  if (data.offerings.length === initialLength) {
    return false;
  }

  writeData(data);
  return true;
}

// Update proof section
export function updateProofSection(proofSection: ProofSection): ProofSection {
  const data = readData();
  data.proofSection = proofSection;
  writeData(data);
  return data.proofSection;
}

// Update carousel settings
export function updateCarouselSettings(settings: CarouselSettings): CarouselSettings {
  const data = readData();
  data.carouselSettings = settings;
  writeData(data);
  return data.carouselSettings;
}

// Calculate monthly price from hourly (730 hours)
export function calculateMonthlyPrice(hourlyPrice: number): number {
  return hourlyPrice * 730;
}

// Format price for display
export function formatPrice(price: number, decimals: number = 2): string {
  return `$${price.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// Format hourly price
export function formatHourlyPrice(price: number): string {
  return `${formatPrice(price)}/hour`;
}

// Format monthly price
export function formatMonthlyPrice(hourlyPrice: number): string {
  const monthly = calculateMonthlyPrice(hourlyPrice);
  return `${formatPrice(monthly)}/month`;
}
