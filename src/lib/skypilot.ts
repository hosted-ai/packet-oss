import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const SKYPILOT_CONFIG_FILE = path.join(process.cwd(), "data", "skypilot-config.json");
const SKYPILOT_ENTRIES_FILE = path.join(process.cwd(), "data", "skypilot-entries.json");

export interface SkyPilotGpuEntry {
  id: string;
  instanceType: string;
  acceleratorName: string;
  acceleratorCount: number;
  vCPUs: number;
  memoryGiB: number;
  pricePerHour: number;
  region: string;
  vramGb: number | null;
  active: boolean;
  poolId: string | null; // Maps to GPU Cloud GPU pool for provisioning
  createdAt: string;
  updatedAt: string;
}

// Find entry by instance type for SkyPilot API
export function getSkyPilotEntryByInstanceType(instanceType: string): SkyPilotGpuEntry | null {
  const entries = getSkyPilotEntries();
  return entries.find((e) => e.instanceType === instanceType && e.active) || null;
}

export interface SkyPilotConfig {
  apiEndpoint: string;
  defaultRegion: string;
  enabledRegions: string[];
  catalogLastGenerated: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFAULT_CONFIG: SkyPilotConfig = {
  apiEndpoint: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  defaultRegion: "eu-north-1",
  enabledRegions: ["eu-north-1"],
  catalogLastGenerated: null,
  updatedAt: null,
  updatedBy: null,
};

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Config functions
export function getSkyPilotConfig(): SkyPilotConfig {
  try {
    if (!fs.existsSync(SKYPILOT_CONFIG_FILE)) {
      return DEFAULT_CONFIG;
    }
    const data = fs.readFileSync(SKYPILOT_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    console.error(`Failed to read SkyPilot config: ${error}`);
    return DEFAULT_CONFIG;
  }
}

export function updateSkyPilotConfig(
  updates: Partial<SkyPilotConfig>,
  updatedBy: string
): SkyPilotConfig {
  ensureDataDir();

  const current = getSkyPilotConfig();
  const updated: SkyPilotConfig = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  fs.writeFileSync(SKYPILOT_CONFIG_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

// Entry functions
export function getSkyPilotEntries(): SkyPilotGpuEntry[] {
  try {
    if (!fs.existsSync(SKYPILOT_ENTRIES_FILE)) {
      return [];
    }
    const data = fs.readFileSync(SKYPILOT_ENTRIES_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Failed to read SkyPilot entries: ${error}`);
    return [];
  }
}

function saveSkyPilotEntries(entries: SkyPilotGpuEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(SKYPILOT_ENTRIES_FILE, JSON.stringify(entries, null, 2));
}

export function createSkyPilotEntry(
  data: Omit<SkyPilotGpuEntry, "id" | "createdAt" | "updatedAt">
): SkyPilotGpuEntry {
  const entries = getSkyPilotEntries();
  const now = new Date().toISOString();

  const newEntry: SkyPilotGpuEntry = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  entries.push(newEntry);
  saveSkyPilotEntries(entries);

  return newEntry;
}

export function updateSkyPilotEntry(
  id: string,
  updates: Partial<Omit<SkyPilotGpuEntry, "id" | "createdAt">>
): SkyPilotGpuEntry | null {
  const entries = getSkyPilotEntries();
  const index = entries.findIndex((e) => e.id === id);

  if (index === -1) {
    return null;
  }

  entries[index] = {
    ...entries[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveSkyPilotEntries(entries);
  return entries[index];
}

export function deleteSkyPilotEntry(id: string): boolean {
  const entries = getSkyPilotEntries();
  const filtered = entries.filter((e) => e.id !== id);

  if (filtered.length === entries.length) {
    return false; // Not found
  }

  saveSkyPilotEntries(filtered);
  return true;
}

// Generate SkyPilot catalog CSV
export function generateSkyPilotCatalogCSV(): string {
  const entries = getSkyPilotEntries().filter((e) => e.active);
  const config = getSkyPilotConfig();

  // CSV header (SkyPilot format)
  const headers = [
    "InstanceType",
    "vCPUs",
    "MemoryGiB",
    "AcceleratorName",
    "AcceleratorCount",
    "GpuInfo",
    "Region",
    "AvailabilityZone",
    "Price",
    "SpotPrice",
  ];

  const rows: string[][] = [headers];

  for (const entry of entries) {
    // Generate GpuInfo JSON
    const gpuInfo = JSON.stringify({
      Gpus: [
        {
          Name: entry.acceleratorName,
          Count: entry.acceleratorCount,
          MemoryMiB: (entry.vramGb || 80) * 1024, // Convert GB to MiB
          Manufacturer: "NVIDIA",
        },
      ],
      TotalGpuMemoryMiB: (entry.vramGb || 80) * 1024 * entry.acceleratorCount,
    });

    // Add row for each enabled region if entry has no specific region,
    // or just the specified region
    const regions = entry.region
      ? [entry.region]
      : config.enabledRegions;

    for (const region of regions) {
      rows.push([
        entry.instanceType,
        entry.vCPUs.toString(),
        entry.memoryGiB.toString(),
        entry.acceleratorName,
        entry.acceleratorCount.toString(),
        `"${gpuInfo.replace(/"/g, '""')}"`, // Escape quotes for CSV
        region,
        "", // AvailabilityZone (GPU Cloud doesn't use zones)
        entry.pricePerHour.toFixed(4),
        "", // SpotPrice (not supported)
      ]);
    }
  }

  // Convert to CSV
  return rows.map((row) => row.join(",")).join("\n");
}

export function markCatalogGenerated(updatedBy: string): void {
  updateSkyPilotConfig(
    { catalogLastGenerated: new Date().toISOString() },
    updatedBy
  );
}

// GPU specifications for different accelerator types
const GPU_SPECS: Record<string, { vramGb: number; vCPUsPerGpu: number; memoryGiBPerGpu: number }> = {
  H100: { vramGb: 80, vCPUsPerGpu: 24, memoryGiBPerGpu: 128 },
  "H100-80GB": { vramGb: 80, vCPUsPerGpu: 24, memoryGiBPerGpu: 128 },
  H200: { vramGb: 141, vCPUsPerGpu: 24, memoryGiBPerGpu: 128 },
  B200: { vramGb: 180, vCPUsPerGpu: 24, memoryGiBPerGpu: 128 },
  A100: { vramGb: 80, vCPUsPerGpu: 16, memoryGiBPerGpu: 128 },
  "A100-80GB": { vramGb: 80, vCPUsPerGpu: 16, memoryGiBPerGpu: 128 },
  "A100-40GB": { vramGb: 40, vCPUsPerGpu: 16, memoryGiBPerGpu: 128 },
  L40S: { vramGb: 48, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  L40: { vramGb: 48, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  A6000: { vramGb: 48, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  RTX4090: { vramGb: 24, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  RTX3090: { vramGb: 24, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  RTX5090: { vramGb: 32, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  "RTX6000-Ada": { vramGb: 48, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
  "RTX6000-Pro": { vramGb: 96, vCPUsPerGpu: 16, memoryGiBPerGpu: 128 },
  RTX6000: { vramGb: 48, vCPUsPerGpu: 16, memoryGiBPerGpu: 64 },
};

// Extract GPU name from product name
function extractGpuName(productName: string): string {
  // Common patterns: "H100 80GB", "A100", "RTX 4090", "RTX 6000 Pro 96GB", etc.
  const normalized = productName.toUpperCase().replace(/\s+/g, "");

  // Check for RTX 6000 variants first (more specific)
  if (normalized.includes("RTX6000") || normalized.includes("RTX 6000")) {
    if (normalized.includes("PRO") || normalized.includes("96GB")) {
      return "RTX6000-Pro";
    }
    if (normalized.includes("ADA") || normalized.includes("48GB")) {
      return "RTX6000-Ada";
    }
    return "RTX6000";
  }

  // Match known GPU names
  const knownGpus = ["H100", "H200", "B200", "A100", "L40S", "L40", "A6000", "RTX4090", "RTX3090", "RTX5090"];
  for (const gpu of knownGpus) {
    if (normalized.includes(gpu.replace(/\s+/g, ""))) {
      return gpu;
    }
  }

  return productName; // Fallback to original name
}

interface GpuProductForSync {
  id: string;
  name: string;
  description?: string | null;
  pricePerHourCents: number;
  poolIds: number[];
  vramGb?: number | null;
  active: boolean;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  entries: SkyPilotGpuEntry[];
}

// Sync SkyPilot entries from GPU products
export function syncFromGpuProducts(products: GpuProductForSync[]): SyncResult {
  const existingEntries = getSkyPilotEntries();
  const config = getSkyPilotConfig();
  const region = config.defaultRegion || "eu-north-1";

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const resultEntries: SkyPilotGpuEntry[] = [];

  for (const product of products) {
    const gpuName = extractGpuName(product.name);
    const specs = GPU_SPECS[gpuName] || { vramGb: product.vramGb || 80, vCPUsPerGpu: 16, memoryGiBPerGpu: 128 };

    // Get pool IDs from product
    const poolIds = product.poolIds || [];
    const poolId = poolIds[0]?.toString() || null;

    // Generate entries for different GPU counts (1x, 2x, 4x, 8x)
    const gpuCounts = [1, 2, 4, 8];

    for (const gpuCount of gpuCounts) {
      const instanceType = `packet-${gpuName.toLowerCase()}-${specs.vramGb}gb-${gpuCount}x`;
      const pricePerHour = (product.pricePerHourCents / 100) * gpuCount;

      // Check if entry already exists
      const existing = existingEntries.find((e) => e.instanceType === instanceType);

      if (existing) {
        // Update if price changed
        if (Math.abs(existing.pricePerHour - pricePerHour) > 0.001 || existing.poolId !== poolId) {
          updateSkyPilotEntry(existing.id, {
            pricePerHour,
            poolId,
            active: product.active,
          });
          updated++;
          resultEntries.push({ ...existing, pricePerHour, poolId, active: product.active });
        } else {
          skipped++;
          resultEntries.push(existing);
        }
      } else {
        // Create new entry
        const newEntry = createSkyPilotEntry({
          instanceType,
          acceleratorName: gpuName,
          acceleratorCount: gpuCount,
          vCPUs: specs.vCPUsPerGpu * gpuCount,
          memoryGiB: specs.memoryGiBPerGpu * gpuCount,
          pricePerHour,
          region,
          vramGb: specs.vramGb,
          poolId,
          active: product.active,
        });
        created++;
        resultEntries.push(newEntry);
      }
    }
  }

  return { created, updated, skipped, entries: resultEntries };
}
