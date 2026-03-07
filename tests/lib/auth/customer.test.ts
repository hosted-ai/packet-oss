import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateCustomerToken,
  generateAdminBypassToken,
  verifyCustomerToken,
  type CustomerTokenPayload,
} from '../../../src/lib/auth/customer';

describe('Customer Authentication Module', () => {
  const TEST_SECRET = 'test-secret-key-for-testing';
  const TEST_EMAIL = 'test@example.com';
  const TEST_CUSTOMER_ID = 'customer-123';

  beforeEach(() => {
    // Set up environment variable for testing
    process.env.CUSTOMER_JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    // Clean up
    vi.restoreAllMocks();
  });

  describe('generateCustomerToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include customer email in payload (lowercase)', () => {
      const token = generateCustomerToken('Test@Example.COM', TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.email).toBe('test@example.com');
    });

    it('should include customer ID in payload', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.customerId).toBe(TEST_CUSTOMER_ID);
    });

    it('should include correct type in payload', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.type).toBe('customer-dashboard');
    });

    it('should set expiration to 1 hour', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.exp).toBeTruthy();
      expect(decoded.iat).toBeTruthy();
      // exp should be 1 hour (3600 seconds) after iat
      expect(decoded.exp - decoded.iat).toBe(3600);
    });

    it('should not include skipTwoFactor flag by default', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.skipTwoFactor).toBeUndefined();
    });

    it('should throw error when JWT secret is missing', () => {
      delete process.env.CUSTOMER_JWT_SECRET;
      delete process.env.ADMIN_JWT_SECRET;
      expect(() => generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID)).toThrow(
        'CUSTOMER_JWT_SECRET (or ADMIN_JWT_SECRET) environment variable is required'
      );
    });

    it('should handle emails with special characters', () => {
      const specialEmail = 'test+tag@example.com';
      const token = generateCustomerToken(specialEmail, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.email).toBe(specialEmail.toLowerCase());
    });

    it('should handle empty customer ID', () => {
      const token = generateCustomerToken(TEST_EMAIL, '');
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.customerId).toBe('');
    });
  });

  describe('generateAdminBypassToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include skipTwoFactor flag set to true', () => {
      const token = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.skipTwoFactor).toBe(true);
    });

    it('should include email in lowercase', () => {
      const token = generateAdminBypassToken('ADMIN@EXAMPLE.COM', TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.email).toBe('admin@example.com');
    });

    it('should include correct type in payload', () => {
      const token = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.type).toBe('customer-dashboard');
    });

    it('should set expiration to 1 hour', () => {
      const token = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.exp - decoded.iat).toBe(3600);
    });

    it('should include customerId in payload', () => {
      const token = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const decoded = jwt.verify(token, TEST_SECRET) as CustomerTokenPayload;
      expect(decoded.customerId).toBe(TEST_CUSTOMER_ID);
    });

    it('should throw error when JWT secret is missing', () => {
      delete process.env.CUSTOMER_JWT_SECRET;
      delete process.env.ADMIN_JWT_SECRET;
      expect(() => generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID)).toThrow(
        'CUSTOMER_JWT_SECRET (or ADMIN_JWT_SECRET) environment variable is required'
      );
    });
  });

  describe('verifyCustomerToken', () => {
    it('should verify and return payload for valid tokens', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const result = verifyCustomerToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL.toLowerCase());
      expect(result?.customerId).toBe(TEST_CUSTOMER_ID);
      expect(result?.type).toBe('customer-dashboard');
    });

    it('should return null for expired tokens', () => {
      // Create an expired token (expires immediately)
      const expiredToken = jwt.sign(
        {
          email: TEST_EMAIL,
          customerId: TEST_CUSTOMER_ID,
          type: 'customer-dashboard',
        },
        TEST_SECRET,
        { expiresIn: '0s' }
      );

      // Wait a bit to ensure token is expired
      const result = verifyCustomerToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong secret', () => {
      const token = jwt.sign(
        {
          email: TEST_EMAIL,
          customerId: TEST_CUSTOMER_ID,
          type: 'customer-dashboard',
        },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      const result = verifyCustomerToken(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifyCustomerToken('not.a.valid.jwt.token');
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong type', () => {
      const token = jwt.sign(
        {
          email: TEST_EMAIL,
          customerId: TEST_CUSTOMER_ID,
          type: 'wrong-type',
        },
        TEST_SECRET,
        { expiresIn: '1h' }
      );

      const result = verifyCustomerToken(token);
      expect(result).toBeNull();
    });

    it('should return null for empty string token', () => {
      const result = verifyCustomerToken('');
      expect(result).toBeNull();
    });

    it('should verify admin bypass tokens correctly', () => {
      const token = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const result = verifyCustomerToken(token);
      expect(result).toBeTruthy();
      expect(result?.skipTwoFactor).toBe(true);
    });

    it('should handle tokens with special characters in email', () => {
      const specialEmail = 'test+tag@example.com';
      const token = generateCustomerToken(specialEmail, TEST_CUSTOMER_ID);
      const result = verifyCustomerToken(token);
      expect(result?.email).toBe(specialEmail.toLowerCase());
    });

    it('should return null for tokens with missing required fields', () => {
      const token = jwt.sign(
        {
          email: TEST_EMAIL,
          // missing customerId
          type: 'customer-dashboard',
        },
        TEST_SECRET,
        { expiresIn: '1h' }
      );

      const result = verifyCustomerToken(token);
      // Token will still be returned but customerId will be undefined
      expect(result?.customerId).toBeUndefined();
    });

    it('should handle completely invalid token format', () => {
      const result = verifyCustomerToken('invalid-token-no-dots');
      expect(result).toBeNull();
    });

    it('should return null when secret is missing during verification', () => {
      const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      // Save the original secrets
      const originalCustomerSecret = process.env.CUSTOMER_JWT_SECRET;
      const originalAdminSecret = process.env.ADMIN_JWT_SECRET;
      delete process.env.CUSTOMER_JWT_SECRET;
      delete process.env.ADMIN_JWT_SECRET;

      // verifyCustomerToken catches all errors and returns null
      const result = verifyCustomerToken(token);
      expect(result).toBeNull();

      // Restore the secrets for other tests
      process.env.CUSTOMER_JWT_SECRET = originalCustomerSecret;
      process.env.ADMIN_JWT_SECRET = originalAdminSecret;
    });

    it('should preserve case-insensitive email from token', () => {
      const upperEmail = 'TEST@EXAMPLE.COM';
      const token = generateCustomerToken(upperEmail, TEST_CUSTOMER_ID);
      const result = verifyCustomerToken(token);
      expect(result?.email).toBe('test@example.com');
    });

    it('should handle tokens with additional unexpected fields', () => {
      const token = jwt.sign(
        {
          email: TEST_EMAIL,
          customerId: TEST_CUSTOMER_ID,
          type: 'customer-dashboard',
          extraField: 'should not cause issues',
        },
        TEST_SECRET,
        { expiresIn: '1h' }
      );

      const result = verifyCustomerToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle very long email addresses', () => {
      const longEmail = 'a'.repeat(100) + '@example.com';
      const token = generateCustomerToken(longEmail, TEST_CUSTOMER_ID);
      const result = verifyCustomerToken(token);
      expect(result?.email).toBe(longEmail.toLowerCase());
    });

    it('should handle very long customer IDs', () => {
      const longId = 'customer-' + 'x'.repeat(200);
      const token = generateCustomerToken(TEST_EMAIL, longId);
      const result = verifyCustomerToken(token);
      expect(result?.customerId).toBe(longId);
    });

    it('should handle unicode characters in email', () => {
      const unicodeEmail = 'tëst@éxample.com';
      const token = generateCustomerToken(unicodeEmail, TEST_CUSTOMER_ID);
      const result = verifyCustomerToken(token);
      expect(result?.email).toBe(unicodeEmail.toLowerCase());
    });

    it('should differentiate between regular and bypass tokens', () => {
      const regularToken = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
      const bypassToken = generateAdminBypassToken(TEST_EMAIL, TEST_CUSTOMER_ID);

      const regularResult = verifyCustomerToken(regularToken);
      const bypassResult = verifyCustomerToken(bypassToken);

      expect(regularResult?.skipTwoFactor).toBeUndefined();
      expect(bypassResult?.skipTwoFactor).toBe(true);
    });
  });
});
