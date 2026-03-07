export interface VoucherData {
  id: string;
  code: string;
  name: string;
  description: string | null;
  creditCents: number;
  minTopupCents: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxPerCustomer: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface VoucherRedemptionData {
  id: string;
  voucherId: string;
  stripeCustomerId: string;
  customerEmail: string;
  topupCents: number;
  creditCents: number;
  stripeSessionId: string | null;
  createdAt: Date;
}

export interface VoucherWithRedemptions extends VoucherData {
  redemptions: VoucherRedemptionData[];
}

export interface VoucherValidationResult {
  valid: boolean;
  error?: string;
  voucher?: {
    code: string;
    name: string;
    creditCents: number;
    minTopupCents: number | null;
  };
}

export interface VoucherStats {
  totalVouchers: number;
  activeVouchers: number;
  totalRedemptions: number;
  totalCreditedCents: number;
  redemptionsThisMonth: number;
  creditedThisMonthCents: number;
  topVouchers: Array<{
    code: string;
    name: string;
    redemptionCount: number;
    totalCredited: number;
  }>;
}

export interface CreateVoucherInput {
  code: string;
  name: string;
  description?: string;
  creditCents: number;
  minTopupCents?: number;
  maxRedemptions?: number;
  maxPerCustomer?: number;
  startsAt?: string;
  expiresAt?: string;
  active?: boolean;
  createdBy?: string;
}

export interface UpdateVoucherInput {
  name?: string;
  description?: string;
  creditCents?: number;
  minTopupCents?: number | null;
  maxRedemptions?: number | null;
  maxPerCustomer?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  active?: boolean;
}
