/**
 * Provider Settings Management
 *
 * Manages configurable settings for GPU provider infrastructure.
 * Settings are stored in data/provider-settings.json
 */

import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "provider-settings.json");

export interface PoolSettings {
  overcommit_ratio: number;
  special_mode: boolean;
  security_mode: "low" | "medium" | "high";
}

export interface RemovalSettings {
  notice_days: number;
}

export interface ProviderSettings {
  pool: PoolSettings;
  removal: RemovalSettings;
}

const DEFAULT_SETTINGS: ProviderSettings = {
  pool: {
    overcommit_ratio: 2.0,
    special_mode: true,
    security_mode: "low",
  },
  removal: {
    notice_days: 7,
  },
};

function readSettings(): ProviderSettings {
  try {
    const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    // Merge with defaults to ensure all fields exist
    return {
      pool: { ...DEFAULT_SETTINGS.pool, ...parsed.pool },
      removal: { ...DEFAULT_SETTINGS.removal, ...parsed.removal },
    };
  } catch (error) {
    console.error(`Failed to read provider settings file: ${error}`);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(data: ProviderSettings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get all provider settings
 */
export function getProviderSettings(): ProviderSettings {
  return readSettings();
}

/**
 * Get pool creation settings
 */
export function getPoolSettings(): PoolSettings {
  return readSettings().pool;
}

/**
 * Get server removal settings
 */
export function getRemovalSettings(): RemovalSettings {
  return readSettings().removal;
}

/**
 * Update pool settings
 */
export function updatePoolSettings(settings: Partial<PoolSettings>): PoolSettings {
  const current = readSettings();
  current.pool = { ...current.pool, ...settings };
  writeSettings(current);
  return current.pool;
}

/**
 * Update removal settings
 */
export function updateRemovalSettings(settings: Partial<RemovalSettings>): RemovalSettings {
  const current = readSettings();
  current.removal = { ...current.removal, ...settings };
  writeSettings(current);
  return current.removal;
}

/**
 * Update all provider settings
 */
export function updateProviderSettings(settings: Partial<ProviderSettings>): ProviderSettings {
  const current = readSettings();
  if (settings.pool) {
    current.pool = { ...current.pool, ...settings.pool };
  }
  if (settings.removal) {
    current.removal = { ...current.removal, ...settings.removal };
  }
  writeSettings(current);
  return current;
}
