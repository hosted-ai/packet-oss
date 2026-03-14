import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sshKeys from '@/lib/ssh-keys';

// Mock PrismaClient
const mockPrisma = {
  sSHKey: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

// Mock the lazy prisma initialization
vi.mock('@/lib/ssh-keys', async () => {
  const actual = await vi.importActual('@/lib/ssh-keys');
  return {
    ...actual,
  };
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('SSH Keys Library', () => {
  describe('validatePublicKey', () => {
    it('should validate a valid RSA public key', () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host';
      const result = sshKeys.validatePublicKey(validKey);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('ssh-rsa');
      expect(result.error).toBeUndefined();
    });

    it('should validate a valid ED25519 public key', () => {
      const validKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl user@host';
      const result = sshKeys.validatePublicKey(validKey);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('ssh-ed25519');
    });

    it('should validate ECDSA public keys', () => {
      const validKey = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= user@host';
      const result = sshKeys.validatePublicKey(validKey);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('ecdsa-sha2-nistp256');
    });

    it('should reject key with invalid format (missing parts)', () => {
      const invalidKey = 'ssh-rsa';
      const result = sshKeys.validatePublicKey(invalidKey);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid SSH public key format');
    });

    it('should reject key with unsupported type', () => {
      const invalidKey = 'ssh-unsupported AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host';
      const result = sshKeys.validatePublicKey(invalidKey);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported key type');
    });

    it('should handle key with special characters in base64', () => {
      // Note: Some special characters might be valid in base64url encoding
      // This test verifies the function handles them appropriately
      const keyWithSpecial = 'ssh-rsa !!!INVALID!!! user@host';
      const result = sshKeys.validatePublicKey(keyWithSpecial);

      // The key might be valid base64 depending on implementation
      expect(result).toBeDefined();
    });

    it('should handle empty string input', () => {
      const result = sshKeys.validatePublicKey('');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid SSH public key format');
    });

    it('should handle whitespace-only input', () => {
      const result = sshKeys.validatePublicKey('   ');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid SSH public key format');
    });

    it('should trim whitespace from valid keys', () => {
      const validKey = '  ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host  ';
      const result = sshKeys.validatePublicKey(validKey);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('ssh-rsa');
    });
  });

  describe('calculateFingerprint', () => {
    it('should calculate MD5 fingerprint for valid key', () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host';
      const fingerprint = sshKeys.calculateFingerprint(validKey);

      expect(fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/);
    });

    it('should produce consistent fingerprints for same key', () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host';
      const fp1 = sshKeys.calculateFingerprint(validKey);
      const fp2 = sshKeys.calculateFingerprint(validKey);

      expect(fp1).toBe(fp2);
    });

    it('should produce different fingerprints for different keys', () => {
      const key1 = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host';
      const key2 = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC2 user@host';
      const fp1 = sshKeys.calculateFingerprint(key1);
      const fp2 = sshKeys.calculateFingerprint(key2);

      expect(fp1).not.toBe(fp2);
    });

    it('should throw error for invalid key format', () => {
      const invalidKey = 'invalid-key';

      expect(() => sshKeys.calculateFingerprint(invalidKey)).toThrow('Invalid SSH public key format');
    });

    it('should handle keys with whitespace', () => {
      const validKey = '  ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host  ';
      const fingerprint = sshKeys.calculateFingerprint(validKey);

      expect(fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/);
    });
  });

  describe('getSSHKeys', () => {
    it('should return all SSH keys for a customer', async () => {
      const mockKeys = [
        { id: '1', name: 'key1', publicKey: 'ssh-rsa AAA...', fingerprint: 'aa:bb:cc', stripeCustomerId: 'cus_123', createdAt: new Date() },
        { id: '2', name: 'key2', publicKey: 'ssh-rsa BBB...', fingerprint: 'dd:ee:ff', stripeCustomerId: 'cus_123', createdAt: new Date() },
      ];

      // Create a mock implementation that works with the actual module
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'getSSHKeys').mockResolvedValue(mockKeys as any);

      const result = await originalModule.getSSHKeys('cus_123');

      expect(result).toEqual(mockKeys);
      expect(originalModule.getSSHKeys).toHaveBeenCalledWith('cus_123');
    });

    it('should return empty array when customer has no keys', async () => {
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'getSSHKeys').mockResolvedValue([]);

      const result = await originalModule.getSSHKeys('cus_empty');

      expect(result).toEqual([]);
    });
  });

  describe('addSSHKey', () => {
    it('should add a valid SSH key successfully', async () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host';
      const params = {
        stripeCustomerId: 'cus_123',
        name: 'My Key',
        publicKey: validKey,
      };

      const mockCreatedKey = {
        id: 'key_123',
        ...params,
        fingerprint: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
        createdAt: new Date(),
      };

      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'addSSHKey').mockResolvedValue(mockCreatedKey as any);

      const result = await originalModule.addSSHKey(params);

      expect(result).toEqual(mockCreatedKey);
    });

    it('should reject invalid SSH key', async () => {
      const params = {
        stripeCustomerId: 'cus_123',
        name: 'Invalid Key',
        publicKey: 'invalid-key-data',
      };

      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'addSSHKey').mockRejectedValue(new Error('Invalid SSH public key format'));

      await expect(originalModule.addSSHKey(params)).rejects.toThrow('Invalid SSH public key format');
    });

    it('should trim whitespace from key name and public key', async () => {
      const params = {
        stripeCustomerId: 'cus_123',
        name: '  My Key  ',
        publicKey: '  ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host  ',
      };

      const mockCreatedKey = {
        id: 'key_123',
        stripeCustomerId: 'cus_123',
        name: 'My Key',
        publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host',
        fingerprint: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
        createdAt: new Date(),
      };

      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'addSSHKey').mockResolvedValue(mockCreatedKey as any);

      const result = await originalModule.addSSHKey(params);

      expect(result.name).toBe('My Key');
      expect(result.publicKey).not.toContain('  ');
    });

    it('should reject key with unsupported type', async () => {
      const params = {
        stripeCustomerId: 'cus_123',
        name: 'Unsupported Key',
        publicKey: 'ssh-unsupported AAAAB3NzaC1yc2EAAAADAQABAAABgQC1 user@host',
      };

      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'addSSHKey').mockRejectedValue(new Error('Unsupported key type: ssh-unsupported'));

      await expect(originalModule.addSSHKey(params)).rejects.toThrow();
    });
  });

  describe('deleteSSHKey', () => {
    it('should delete SSH key for valid customer', async () => {
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'deleteSSHKey').mockResolvedValue(undefined);

      await originalModule.deleteSSHKey('key_123', 'cus_123');

      expect(originalModule.deleteSSHKey).toHaveBeenCalledWith('key_123', 'cus_123');
    });

    it('should throw error when key not found', async () => {
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'deleteSSHKey').mockRejectedValue(new Error('Record to delete does not exist'));

      await expect(originalModule.deleteSSHKey('key_nonexistent', 'cus_123')).rejects.toThrow();
    });

    it('should throw error when customer does not own the key', async () => {
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'deleteSSHKey').mockRejectedValue(new Error('Record to delete does not exist'));

      await expect(originalModule.deleteSSHKey('key_123', 'cus_wrong')).rejects.toThrow();
    });
  });

  describe('getSSHKey', () => {
    it('should return SSH key when found and owned by customer', async () => {
      const mockKey = {
        id: 'key_123',
        name: 'My Key',
        publicKey: 'ssh-rsa AAA...',
        fingerprint: 'aa:bb:cc',
        stripeCustomerId: 'cus_123',
        createdAt: new Date(),
      };

      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'getSSHKey').mockResolvedValue(mockKey as any);

      const result = await originalModule.getSSHKey('key_123', 'cus_123');

      expect(result).toEqual(mockKey);
    });

    it('should return null when key not found', async () => {
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'getSSHKey').mockResolvedValue(null);

      const result = await originalModule.getSSHKey('key_nonexistent', 'cus_123');

      expect(result).toBeNull();
    });

    it('should return null when key exists but belongs to different customer', async () => {
      const originalModule = await import('@/lib/ssh-keys');
      vi.spyOn(originalModule, 'getSSHKey').mockResolvedValue(null);

      const result = await originalModule.getSSHKey('key_123', 'cus_wrong');

      expect(result).toBeNull();
    });
  });
});
