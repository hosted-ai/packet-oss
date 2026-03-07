import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Stripe from 'stripe';
import {
  getWalletBalance,
  fundWallet,
  deductUsage,
  checkAndRefillWallet,
  getWalletTransactions,
  calculateCost,
  formatCents,
  WALLET_CONFIG,
} from '@/lib/wallet';

// Mock dependencies
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => mockStripe),
}));

vi.mock('@/lib/pricing', () => ({
  getHourlyRateCents: vi.fn(() => 200), // $2/hour
  getAutoRefillThresholdCents: vi.fn(() => 2000), // $20
  getAutoRefillAmountCents: vi.fn(() => 10000), // $100
}));

// Create mock Stripe instance
const mockStripe = {
  customers: {
    retrieve: vi.fn(),
    update: vi.fn(),
    createBalanceTransaction: vi.fn(),
    listBalanceTransactions: vi.fn(),
  },
  paymentIntents: {
    create: vi.fn(),
    list: vi.fn(),
  },
} as unknown as Stripe;

describe('Wallet Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getWalletBalance', () => {
    it('should return wallet balance from Stripe customer balance', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: -5000, // Customer has $50 credit (negative means credit)
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await getWalletBalance('cus_test123');

      expect(result).toEqual({
        availableBalance: 5000, // Flipped to positive
        pendingBalance: 0,
        currency: 'usd',
      });
      expect(mockStripe.customers.retrieve).toHaveBeenCalledWith('cus_test123');
    });

    it('should handle customer with zero balance', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 0,
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await getWalletBalance('cus_test123');

      expect(Math.abs(result.availableBalance)).toBe(0);
    });

    it('should handle customer with debt (positive balance)', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 3000, // Customer owes $30
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await getWalletBalance('cus_test123');

      expect(result.availableBalance).toBe(-3000); // Negative means they owe
    });

    it('should handle undefined balance', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: undefined,
      } as unknown as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await getWalletBalance('cus_test123');

      expect(Math.abs(result.availableBalance)).toBe(0);
    });

    it('should propagate Stripe API errors', async () => {
      vi.mocked(mockStripe.customers.retrieve).mockRejectedValue(
        new Error('Customer not found')
      );

      await expect(getWalletBalance('cus_invalid')).rejects.toThrow('Customer not found');
    });
  });

  describe('fundWallet', () => {
    it('should successfully fund wallet with payment method', async () => {
      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'succeeded',
      } as Stripe.PaymentIntent;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);

      const result = await fundWallet('cus_test123', 5000, 'pm_test456');

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe('pi_test123');
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 5000,
        currency: 'usd',
        customer: 'cus_test123',
        payment_method: 'pm_test456',
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          type: 'wallet_funding',
          description: 'Wallet auto-refill',
        },
      });
      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalledWith('cus_test123', {
        amount: -5000,
        currency: 'usd',
        description: 'Wallet funding',
        metadata: {
          payment_intent_id: 'pi_test123',
        },
      });
    });

    it('should use default payment method if not provided', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        invoice_settings: {
          default_payment_method: 'pm_default789',
        },
      } as Stripe.Customer;

      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'succeeded',
      } as Stripe.PaymentIntent;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);

      const result = await fundWallet('cus_test123', 3000);

      expect(result.success).toBe(true);
      expect(mockStripe.customers.retrieve).toHaveBeenCalledWith('cus_test123');
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'pm_default789',
        })
      );
    });

    it('should return error if no payment method available', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        invoice_settings: {},
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await fundWallet('cus_test123', 3000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No payment method on file');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should handle payment intent failure', async () => {
      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'requires_action',
      } as Stripe.PaymentIntent;

      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);

      const result = await fundWallet('cus_test123', 5000, 'pm_test456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Payment status: requires_action');
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should prevent duplicate credits (idempotency)', async () => {
      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'succeeded',
      } as Stripe.PaymentIntent;

      const mockTransactions = {
        data: [
          {
            id: 'txn_existing',
            created: Math.floor(Date.now() / 1000),
            metadata: {
              payment_intent_id: 'pi_test123',
            },
          } as Stripe.CustomerBalanceTransaction,
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);

      const result = await fundWallet('cus_test123', 5000, 'pm_test456');

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe('pi_test123');
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should handle Stripe API errors gracefully', async () => {
      vi.mocked(mockStripe.paymentIntents.create).mockRejectedValue(
        new Error('Card declined')
      );

      const result = await fundWallet('cus_test123', 5000, 'pm_test456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Card declined');
    });
  });

  describe('deductUsage', () => {
    it('should deduct usage from customer balance', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1000, // Customer owes $10 after deduction
      } as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours');

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(1000);
      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalledWith('cus_test123', {
        amount: 500, // 2.5 hours * $2/hour = $5
        currency: 'usd',
        description: 'GPU usage: 2.5 hours',
        metadata: {
          hours_used: '2.5',
          rate_cents: '200',
        },
      });
    });

    it('should handle zero hours gracefully', async () => {
      const result = await deductUsage('cus_test123', 0, 'No usage');

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(0);
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should handle negative hours gracefully', async () => {
      const result = await deductUsage('cus_test123', -1, 'Invalid usage');

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(0);
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should prevent duplicate deductions (race condition)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockTransactions = {
        data: [
          {
            id: 'txn_duplicate',
            description: 'GPU usage: 2.5 hours',
            created: now - 60, // Created 1 minute ago
          } as Stripe.CustomerBalanceTransaction,
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockCustomer = {
        id: 'cus_test123',
        balance: 500,
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours');

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should allow deduction if duplicate is old (> 5 minutes)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockTransactions = {
        data: [
          {
            id: 'txn_old',
            description: 'GPU usage: 2.5 hours',
            created: now - 400, // Created 6+ minutes ago
          } as Stripe.CustomerBalanceTransaction,
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockCustomer = {
        id: 'cus_test123',
        balance: 500,
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours');

      expect(result.success).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalled();
    });

    it('should handle Stripe API errors', async () => {
      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockRejectedValue(
        new Error('Insufficient funds')
      );

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');
    });

    it('should round amount correctly', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 100,
      } as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      await deductUsage('cus_test123', 1.333, 'Fractional hours');

      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
        'cus_test123',
        expect.objectContaining({
          amount: 267, // Math.round(1.333 * 200) = 267
        })
      );
    });
  });

  describe('checkAndRefillWallet', () => {
    it('should refill wallet when balance is below threshold', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500, // Customer has $15 credit (below $20 threshold)
        invoice_settings: {
          default_payment_method: 'pm_default',
        },
        metadata: {},
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockPaymentIntent = {
        id: 'pi_refill123',
        status: 'succeeded',
      } as Stripe.PaymentIntent;

      const mockPaymentIntents = {
        data: [],
      } as Stripe.ApiList<Stripe.PaymentIntent>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(mockStripe.paymentIntents.list).mockResolvedValue(mockPaymentIntents);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(true);
      expect(result.amount).toBe(10000); // $100 refill
      expect(mockStripe.customers.update).toHaveBeenCalledTimes(2); // Set lock, clear lock
    });

    it('should not refill if balance is above threshold', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: -3000, // Customer has $30 credit (above $20 threshold)
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(mockStripe.customers.update).not.toHaveBeenCalled();
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should skip refill if recent refill exists', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: {},
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [
          {
            id: 'txn_recent',
            description: 'Wallet funding',
            created: now - 300, // 5 minutes ago
          } as Stripe.CustomerBalanceTransaction,
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(result.error).toContain('Recent refill already processed');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should skip refill if refill is in progress (lock exists)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: {
          wallet_refill_lock: (now - 60).toString(), // Locked 1 minute ago
        },
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(result.error).toContain('Refill already in progress');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should proceed if lock is stale (> 2 minutes old)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        invoice_settings: {
          default_payment_method: 'pm_default',
        },
        metadata: {
          wallet_refill_lock: (now - 200).toString(), // Locked 3+ minutes ago (stale)
        },
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockPaymentIntent = {
        id: 'pi_refill123',
        status: 'succeeded',
      } as Stripe.PaymentIntent;

      const mockPaymentIntents = {
        data: [],
      } as Stripe.ApiList<Stripe.PaymentIntent>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(mockStripe.paymentIntents.list).mockResolvedValue(mockPaymentIntents);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(true);
    });

    it('should detect race condition after acquiring lock', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: {},
        invoice_settings: {},
      } as unknown as Stripe.Customer;

      const mockTransactionsEmpty = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockTransactionsWithRefill = {
        data: [
          {
            id: 'txn_race',
            description: 'Wallet funding',
            created: now - 100, // Very recent
          } as Stripe.CustomerBalanceTransaction,
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions)
        .mockResolvedValueOnce(mockTransactionsEmpty) // First check: no refills
        .mockResolvedValueOnce(mockTransactionsWithRefill); // After lock: refill found
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(result.error).toContain('detected after lock');
      expect(mockStripe.customers.update).toHaveBeenCalledWith(
        'cus_test123',
        expect.objectContaining({
          metadata: expect.objectContaining({
            wallet_refill_lock: '',
          }),
        })
      );
    });

    it('should check for recent wallet payment intents', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: {},
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockPaymentIntents = {
        data: [
          {
            id: 'pi_recent',
            status: 'succeeded',
            metadata: {
              type: 'wallet_funding',
            },
          } as Stripe.PaymentIntent,
        ],
      } as Stripe.ApiList<Stripe.PaymentIntent>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.list).mockResolvedValue(mockPaymentIntents);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(result.error).toContain('Recent wallet payment already processed');
    });

    it('should clear lock on funding failure', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: {},
        invoice_settings: {},
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      const mockPaymentIntents = {
        data: [],
      } as Stripe.ApiList<Stripe.PaymentIntent>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.list).mockResolvedValue(mockPaymentIntents);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(mockStripe.customers.update).toHaveBeenCalledWith(
        'cus_test123',
        expect.objectContaining({
          metadata: expect.objectContaining({
            wallet_refill_lock: '',
          }),
        })
      );
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockStripe.customers.retrieve).mockRejectedValue(
        new Error('Network error')
      );

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('getWalletTransactions', () => {
    it('should retrieve transaction history', async () => {
      const mockTransactions = {
        data: [
          {
            id: 'txn_1',
            amount: -5000,
            description: 'Wallet funding',
            created: 1234567890,
          },
          {
            id: 'txn_2',
            amount: 200,
            description: 'GPU usage',
            created: 1234567880,
          },
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);

      const result = await getWalletTransactions('cus_test123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('txn_1');
      expect(mockStripe.customers.listBalanceTransactions).toHaveBeenCalledWith('cus_test123', {
        limit: 20,
      });
    });

    it('should support custom limit', async () => {
      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);

      await getWalletTransactions('cus_test123', 50);

      expect(mockStripe.customers.listBalanceTransactions).toHaveBeenCalledWith('cus_test123', {
        limit: 50,
      });
    });

    it('should use default limit of 20', async () => {
      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);

      await getWalletTransactions('cus_test123');

      expect(mockStripe.customers.listBalanceTransactions).toHaveBeenCalledWith('cus_test123', {
        limit: 20,
      });
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for given hours', () => {
      expect(calculateCost(1)).toBe(200); // 1 hour * $2/hour
      expect(calculateCost(2.5)).toBe(500); // 2.5 hours * $2/hour
      expect(calculateCost(10)).toBe(2000); // 10 hours * $2/hour
    });

    it('should handle zero hours', () => {
      expect(calculateCost(0)).toBe(0);
    });

    it('should handle fractional hours', () => {
      expect(calculateCost(0.5)).toBe(100); // 0.5 hours * $2/hour
      expect(calculateCost(1.333)).toBe(267); // Rounded
    });

    it('should handle large numbers', () => {
      expect(calculateCost(100)).toBe(20000);
    });
  });

  describe('formatCents', () => {
    it('should format cents to dollar string', () => {
      expect(formatCents(100)).toBe('$1.00');
      expect(formatCents(1500)).toBe('$15.00');
      expect(formatCents(10000)).toBe('$100.00');
    });

    it('should handle zero', () => {
      expect(formatCents(0)).toBe('$0.00');
    });

    it('should handle negative amounts', () => {
      expect(formatCents(-500)).toBe('$-5.00');
    });

    it('should handle fractional cents', () => {
      expect(formatCents(1)).toBe('$0.01');
      expect(formatCents(99)).toBe('$0.99');
    });

    it('should always show two decimal places', () => {
      expect(formatCents(1000)).toBe('$10.00');
      expect(formatCents(1050)).toBe('$10.50');
    });
  });

  describe('WALLET_CONFIG', () => {
    it('should provide access to hourly rate', () => {
      expect(WALLET_CONFIG.hourlyRateCents).toBe(200);
    });

    it('should provide access to auto-refill threshold', () => {
      expect(WALLET_CONFIG.autoRefillThresholdCents).toBe(2000);
    });

    it('should provide access to auto-refill amount', () => {
      expect(WALLET_CONFIG.autoRefillAmountCents).toBe(10000);
    });
  });
});
