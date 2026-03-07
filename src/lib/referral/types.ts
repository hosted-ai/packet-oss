export interface ReferralSettings {
  enabled: boolean;
  rewardAmountCents: number; // $100 = 10000
  minTopupCents: number; // Minimum top-up to qualify
  maxReferralsPerCustomer: number; // 0 = unlimited
}

export interface ReferralCode {
  id: string;
  code: string;
  stripeCustomerId: string;
  createdAt: Date;
}

export interface ReferralClaim {
  id: string;
  referralCodeId: string;
  refereeCustomerId: string;
  refereeEmail: string;
  status: "pending" | "qualified" | "credited" | "expired";
  qualifiedAt: Date | null;
  creditedAt: Date | null;
  referrerCredited: boolean;
  refereeCredited: boolean;
  createdAt: Date;
}

export interface ReferralStats {
  code: string;
  totalReferrals: number;
  pendingReferrals: number;
  creditedReferrals: number;
  totalEarned: number; // in cents
}

export interface ReferralClaimWithDetails extends ReferralClaim {
  referrerEmail?: string;
  referrerCustomerId?: string;
  code?: string;
}

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  enabled: true,
  rewardAmountCents: 10000, // $100
  minTopupCents: 10000, // $100 minimum
  maxReferralsPerCustomer: 0, // unlimited
};
