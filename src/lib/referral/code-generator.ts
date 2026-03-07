// Funky word combinations for referral codes
// Generates codes like "cosmic-penguin", "turbo-falcon", "neon-dragon"

const adjectives = [
  // Space/Tech themed
  "cosmic", "quantum", "stellar", "lunar", "solar", "astro", "cyber", "pixel",
  // Energy/Speed themed
  "turbo", "hyper", "ultra", "mega", "super", "nitro", "sonic", "rapid",
  // Color/Light themed
  "neon", "crystal", "blazing", "electric", "golden", "silver", "crimson", "azure",
  // Nature/Element themed
  "atomic", "thunder", "frost", "shadow", "iron", "storm", "ember", "vapor",
  // Cool adjectives
  "epic", "noble", "brave", "swift", "bold", "fierce", "mighty", "clever",
];

const nouns = [
  // Birds
  "falcon", "phoenix", "raven", "hawk", "eagle", "owl", "condor", "sparrow",
  // Big cats
  "tiger", "panther", "lynx", "jaguar", "leopard", "lion", "puma", "cheetah",
  // Mythical
  "dragon", "griffin", "hydra", "sphinx", "kraken", "titan", "golem", "wyrm",
  // Other animals
  "wolf", "cobra", "viper", "mantis", "raptor", "shark", "bear", "fox",
  // Cool nouns
  "ninja", "knight", "wizard", "pilot", "rocket", "comet", "blade", "spark",
];

/**
 * Generate a unique funky referral code
 * Format: adjective-noun (e.g., "cosmic-penguin")
 */
export function generateReferralCode(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective}-${noun}`;
}

/**
 * Generate a unique code that doesn't exist in the database
 * Retries up to maxAttempts times if collision detected
 */
export async function generateUniqueCode(
  existingCodes: Set<string>,
  maxAttempts: number = 100
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateReferralCode();
    if (!existingCodes.has(code)) {
      return code;
    }
  }

  // Fallback: add random suffix if all combinations exhausted
  const base = generateReferralCode();
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${base}-${suffix}`;
}

/**
 * Validate a referral code format
 */
export function isValidCodeFormat(code: string): boolean {
  // Should be lowercase, two words separated by hyphen
  const pattern = /^[a-z]+-[a-z]+(-[a-z0-9]+)?$/;
  return pattern.test(code.toLowerCase());
}

/**
 * Normalize a code for lookup (lowercase, trim)
 */
export function normalizeCode(code: string): string {
  return code.toLowerCase().trim();
}
