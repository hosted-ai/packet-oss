import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';

describe('crypto', () => {
  it('encrypts and decrypts a string', () => {
    const secret = 'sk_test_abc123';
    const encrypted = encrypt(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted).toContain(':');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertexts for same input', () => {
    const secret = 'sk_test_abc123';
    const a = encrypt(secret);
    const b = encrypt(secret);
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const tampered = encrypted.slice(0, -2) + 'xx';
    expect(() => decrypt(tampered)).toThrow();
  });
});
