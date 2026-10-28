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
  formatCentsSigned,
  refundDeployment,
  WALLET_CONFIG,
} from '@/lib/wallet';
import { createInvoiceForPayment, heldByInvoiceGeneration } from '@/lib/invoice';

const { mockWalletTxnCreate } = vi.hoisted(() => ({ mockWalletTxnCreate: vi.fn() }));

// Mock dependencies
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => mockStripe),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { walletTransaction: { create: mockWalletTxnCreate } },
}));

vi.mock('@/lib/pricing', () => ({
  getHourlyRateCents: vi.fn(() => 200), // $2/hour
  getAutoRefillThresholdCents: vi.fn(() => 2000), // $20
  getAutoRefillAmountCents: vi.fn(() => 10000), // $100 default
}));

// Mock the invoice module - use the real Stripe mock to verify invoice API calls
vi.mock('@/lib/invoice', () => ({
  createInvoiceForPayment: vi.fn().mockResolvedValue({ id: 'inv_mock' }),
  heldByInvoiceGeneration: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/analytics/ga4', () => ({
  trackPurchase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/analytics/posthog', () => ({
  posthogTrackPurchase: vi.fn().mockResolvedValue(undefined),
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
  invoices: {
    create: vi.fn(),
    finalizeInvoice: vi.fn(),
    pay: vi.fn(),
  },
  invoiceItems: {
    create: vi.fn(),
  },
} as unknown as Stripe;

describe('Wallet Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(heldByInvoiceGeneration).mockResolvedValue(0);
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

    // A credited/coupon wallet reads $0.00 on customer.balance while invoice
    // generation holds it, which blocked funded customers from deploying.
    it('counts credit that an invoice hold is sitting on', async () => {
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue({
        id: 'cus_coupon',
        balance: 0,
      } as Stripe.Customer);
      vi.mocked(heldByInvoiceGeneration).mockResolvedValue(10000);

      const result = await getWalletBalance('cus_coupon');

      expect(result.availableBalance).toBe(10000);
      expect(heldByInvoiceGeneration).toHaveBeenCalledWith(mockStripe, 'cus_coupon');
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
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue({
        id: 'cus_test123',
        email: 'test@example.com',
        balance: -5000,
      } as unknown as Stripe.Customer);

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

    it('should create a Stripe invoice for successful auto-refill payments (PA-102)', async () => {
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
      // PA-102: An invoice MUST be created for auto-refill payments
      expect(createInvoiceForPayment).toHaveBeenCalledWith(
        mockStripe,         // stripe instance
        'cus_test123',      // customerId
        5000,               // amount
        'Wallet auto-refill', // description
        'pi_test123'        // paymentIntentId
      );
    });

    it('should NOT create an invoice when payment fails (PA-102)', async () => {
      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'requires_action',
      } as Stripe.PaymentIntent;

      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(createInvoiceForPayment).mockClear();

      const result = await fundWallet('cus_test123', 5000, 'pm_test456');

      expect(result.success).toBe(false);
      expect(createInvoiceForPayment).not.toHaveBeenCalled();
    });

    it('should NOT create an invoice for duplicate refills (PA-102)', async () => {
      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'succeeded',
      } as Stripe.PaymentIntent;

      const mockTransactions = {
        data: [
          {
            id: 'txn_existing',
            created: Math.floor(Date.now() / 1000),
            metadata: { payment_intent_id: 'pi_test123' },
          } as Stripe.CustomerBalanceTransaction,
        ],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockPaymentIntent);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(createInvoiceForPayment).mockClear();

      const result = await fundWallet('cus_test123', 5000, 'pm_test456');

      expect(result.success).toBe(true);
      // Duplicate — no invoice should be created
      expect(createInvoiceForPayment).not.toHaveBeenCalled();
    });
  });

  describe('deductUsage', () => {
    it('should deduct usage from customer balance', async () => {
      // Negative balance = customer has credit. Need >= 500c credit to pass the
      // BALANCE GUARD for a 2.5h * 200c = 500c debit.
      const mockCustomer = {
        id: 'cus_test123',
        balance: -1000, // Customer has $10 credit
      } as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      // hourlyRateCents (200 = $2/hr) is now a required argument.
      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours', 200);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(-1000);
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

    // The HF/GPU deploy charge runs straight after the balance gate, so held
    // credit has to satisfy the guard too or the deploy fails at the charge.
    it('charges against credit that an invoice hold is sitting on', async () => {
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue({
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue({
        id: 'cus_coupon',
        balance: 0,
      } as Stripe.Customer);
      vi.mocked(heldByInvoiceGeneration).mockResolvedValue(10000);

      const result = await deductUsage('cus_coupon', 0.5, 'HF deploy pre-charge', 143);

      expect(result.success).toBe(true);
      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
        'cus_coupon',
        expect.objectContaining({ amount: 72 }),
      );
    });

    it('should handle zero hours gracefully', async () => {
      const result = await deductUsage('cus_test123', 0, 'No usage', 200);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(0);
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should handle negative hours gracefully', async () => {
      const result = await deductUsage('cus_test123', -1, 'Invalid usage', 200);

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
        balance: -1000, // $10 credit (enough to pass the BALANCE GUARD)
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours', 200);

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
        balance: -1000, // $10 credit (enough to pass the BALANCE GUARD)
      } as Stripe.Customer;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours', 200);

      expect(result.success).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalled();
    });

    it('should handle Stripe API errors', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: -1000, // $10 credit (enough to pass the BALANCE GUARD)
      } as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockRejectedValue(
        new Error('Insufficient funds')
      );

      const result = await deductUsage('cus_test123', 2.5, 'GPU usage: 2.5 hours', 200);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');
    });

    it('should round amount correctly', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: -1000, // $10 credit (enough to pass the BALANCE GUARD)
      } as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue({} as Stripe.CustomerBalanceTransaction);
      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      await deductUsage('cus_test123', 1.333, 'Fractional hours', 200);

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
        metadata: { auto_refill_enabled: "true" },
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
        metadata: { auto_refill_enabled: "true" },
      } as unknown as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(mockStripe.customers.update).not.toHaveBeenCalled();
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('does NOT refill when auto-refill is not enabled (opt-in default off)', async () => {
      // No auto_refill_enabled flag → balance is low but we must never charge.
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500, // $15 credit, well below threshold
        invoice_settings: { default_payment_method: 'pm_default' },
        metadata: {},
      } as unknown as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(mockStripe.customers.update).not.toHaveBeenCalled();
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it("uses the customer's configured amount, not the global default", async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500, // $15, below the customer's $100 threshold
        invoice_settings: { default_payment_method: 'pm_default' },
        metadata: {
          auto_refill_enabled: "true",
          auto_refill_amount_cents: "50000", // $500
          auto_refill_threshold_cents: "10000", // $100
        },
      } as unknown as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue({
        data: [],
      } as unknown as Stripe.ApiList<Stripe.CustomerBalanceTransaction>);
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue({ id: 'pi_x', status: 'succeeded' } as Stripe.PaymentIntent);
      vi.mocked(mockStripe.paymentIntents.list).mockResolvedValue({ data: [] } as unknown as Stripe.ApiList<Stripe.PaymentIntent>);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(true);
      expect(result.amount).toBe(50000); // the customer's $500, NOT the $100 default
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 50000 })
      );
    });

    it('respects the customer threshold (no refill when above their chosen threshold)', async () => {
      // Customer set a $100 threshold; they have $30 credit which is below the
      // global $20 default but ABOVE their own $100... wait — $30 < $100 → refills.
      // Here give them $150 credit (above their $100 threshold) → no refill.
      const mockCustomer = {
        id: 'cus_test123',
        balance: -15000, // $150 credit
        invoice_settings: { default_payment_method: 'pm_default' },
        metadata: {
          auto_refill_enabled: "true",
          auto_refill_amount_cents: "50000",
          auto_refill_threshold_cents: "10000", // $100 threshold
        },
      } as unknown as Stripe.Customer;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should skip refill if recent refill exists', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: { auto_refill_enabled: "true" },
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
          auto_refill_enabled: "true",
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
          auto_refill_enabled: "true",
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
        metadata: { auto_refill_enabled: "true" },
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
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: { auto_refill_enabled: "true" },
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

    it('does NOT credit the wallet when the Stripe charge fails (card declined)', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500, // $15 credit, below the $20 threshold
        invoice_settings: { default_payment_method: 'pm_default' },
        metadata: { auto_refill_enabled: "true" },
      } as unknown as Stripe.Customer;

      const mockTransactions = {
        data: [],
      } as Stripe.ApiList<Stripe.CustomerBalanceTransaction>;

      // Stripe declines the card — payment intent doesn't reach "succeeded".
      const mockDeclinedIntent = {
        id: 'pi_declined',
        status: 'requires_action',
      } as Stripe.PaymentIntent;

      const mockPaymentIntents = {
        data: [],
      } as Stripe.ApiList<Stripe.PaymentIntent>;

      vi.mocked(mockStripe.customers.retrieve).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockResolvedValue(mockTransactions);
      vi.mocked(mockStripe.customers.update).mockResolvedValue(mockCustomer);
      vi.mocked(mockStripe.paymentIntents.create).mockResolvedValue(mockDeclinedIntent);
      vi.mocked(mockStripe.paymentIntents.list).mockResolvedValue(mockPaymentIntents);

      const result = await checkAndRefillWallet('cus_test123');

      expect(result.refilled).toBe(false);
      expect(result.error).toBe('Payment status: requires_action');
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    });

    it('should clear lock on funding failure', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        balance: 1500,
        metadata: { auto_refill_enabled: "true" },
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

      // maxItems > 0 takes the fast single-call path.
      const result = await getWalletTransactions('cus_test123', 20);

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

    it('should auto-paginate all transactions when no limit is given', async () => {
      // Default maxItems=0 means "unlimited": the code uses Stripe's async
      // auto-pagination (for await … limit: 100). Mock an async-iterable list.
      const txns = [
        { id: 'txn_a' } as Stripe.CustomerBalanceTransaction,
        { id: 'txn_b' } as Stripe.CustomerBalanceTransaction,
      ];
      vi.mocked(mockStripe.customers.listBalanceTransactions).mockReturnValue({
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            next: () =>
              Promise.resolve(
                i < txns.length
                  ? { value: txns[i++], done: false }
                  : { value: undefined, done: true }
              ),
          };
        },
      } as unknown as ReturnType<typeof mockStripe.customers.listBalanceTransactions>);

      const result = await getWalletTransactions('cus_test123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('txn_a');
      expect(mockStripe.customers.listBalanceTransactions).toHaveBeenCalledWith('cus_test123', {
        limit: 100,
      });
    });
  });

  describe('calculateCost', () => {
    // calculateCost(hours, hourlyRateCents) — rate is now a required 2nd arg
    // (GPU rates come from the GpuProduct model). 200c = $2/hour.
    it('should calculate cost for given hours', () => {
      expect(calculateCost(1, 200)).toBe(200); // 1 hour * $2/hour
      expect(calculateCost(2.5, 200)).toBe(500); // 2.5 hours * $2/hour
      expect(calculateCost(10, 200)).toBe(2000); // 10 hours * $2/hour
    });

    it('should handle zero hours', () => {
      expect(calculateCost(0, 200)).toBe(0);
    });

    it('should handle fractional hours', () => {
      expect(calculateCost(0.5, 200)).toBe(100); // 0.5 hours * $2/hour
      expect(calculateCost(1.333, 200)).toBe(267); // Rounded
    });

    it('should handle large numbers', () => {
      expect(calculateCost(100, 200)).toBe(20000);
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

  describe('formatCentsSigned (PA-339)', () => {
    it('formats a positive (credit) balance like formatCents', () => {
      expect(formatCentsSigned(2000)).toBe('$20.00');
      expect(formatCentsSigned(0)).toBe('$0.00');
    });

    it('renders a negative (arrears) balance as -$X.XX, not $-X.XX or clamped $0.00', () => {
      expect(formatCentsSigned(-24500)).toBe('-$245.00');
      expect(formatCentsSigned(-1)).toBe('-$0.01');
    });
  });

  describe('WALLET_CONFIG', () => {
    it('should NOT expose a static hourly rate (GPU rates come from GpuProduct)', () => {
      expect((WALLET_CONFIG as Record<string, unknown>).hourlyRateCents).toBeUndefined();
    });

    it('should provide access to auto-refill threshold', () => {
      expect(WALLET_CONFIG.autoRefillThresholdCents).toBe(2000);
    });

    it('should provide access to auto-refill amount', () => {
      expect(WALLET_CONFIG.autoRefillAmountCents).toBe(10000);
    });
  });

  // PA-693: failed-deploy refunds must land in the wallet ledger (type "refund",
  // negative cents) so revenue and provider payout figures net them out.
  describe('refundDeployment', () => {
    beforeEach(() => {
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockResolvedValue(
        {} as Stripe.Response<Stripe.CustomerBalanceTransaction>,
      );
      mockWalletTxnCreate.mockResolvedValue({});
    });

    it('credits Stripe AND mirrors a negative refund row into the ledger', async () => {
      const result = await refundDeployment('cus_1', 2500, 'Deploy failed: no capacity');
      expect(result.success).toBe(true);
      expect(mockStripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
        'cus_1',
        expect.objectContaining({ amount: -2500 }),
      );
      expect(mockWalletTxnCreate).toHaveBeenCalledWith({
        data: {
          stripeCustomerId: 'cus_1',
          type: 'refund',
          amountCents: -2500,
          description: 'Deploy failed: no capacity',
          metadata: JSON.stringify({ source: 'deployment_refund' }),
        },
      });
    });

    it('a ledger write failure never fails the refund (customer already credited)', async () => {
      mockWalletTxnCreate.mockRejectedValue(new Error('db down'));
      const result = await refundDeployment('cus_1', 2500, 'Deploy failed');
      expect(result.success).toBe(true);
    });

    it('short-circuits on amountCents <= 0 — no Stripe call, no ledger row', async () => {
      const result = await refundDeployment('cus_1', 0, 'nothing to refund');
      expect(result.success).toBe(true);
      expect(mockStripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
      expect(mockWalletTxnCreate).not.toHaveBeenCalled();
    });

    it('a Stripe failure returns success:false and writes NO ledger row', async () => {
      vi.mocked(mockStripe.customers.createBalanceTransaction).mockRejectedValue(
        new Error('stripe down'),
      );
      const result = await refundDeployment('cus_1', 2500, 'Deploy failed');
      expect(result.success).toBe(false);
      expect(mockWalletTxnCreate).not.toHaveBeenCalled();
    });
  });
});
