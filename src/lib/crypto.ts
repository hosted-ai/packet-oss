import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

let derivedKey: Buffer | null = null;

function getKey(): Buffer {
  if (derivedKey) return derivedKey;

  const key = process.env.TENANT_ENCRYPTION_KEY;
  if (key) {
    derivedKey = Buffer.from(key, 'hex');
    return derivedKey;
  }

  // Derive from ADMIN_JWT_SECRET if TENANT_ENCRYPTION_KEY not set
  const jwtSecret = process.env.ADMIN_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      "No encryption key available. Set ADMIN_JWT_SECRET or TENANT_ENCRYPTION_KEY."
    );
  }
  derivedKey = scryptSync(jwtSecret, "packet-oss-crypto", 32);
  return derivedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
