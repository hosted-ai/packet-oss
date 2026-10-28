export const testCustomer = {
  id: 'test-customer-id',
  email: 'test@example.com',
  stripeCustomerId: 'cus_test123456',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

export const testTeamMember = {
  id: 'test-team-member-id',
  customerId: 'test-customer-id',
  email: 'member@example.com',
  name: 'Test Member',
  role: 'OWNER' as const,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

export const testApiKey = {
  id: 'test-api-key-id',
  customerId: 'test-customer-id',
  name: 'Test API Key',
  key: 'test-api-key-hash',
  prefix: 'pk_test',
  lastUsedAt: new Date('2024-01-01T00:00:00.000Z'),
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

export const testSSHKey = {
  id: 'test-ssh-key-id',
  customerId: 'test-customer-id',
  name: 'Test SSH Key',
  publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDTest...',
  fingerprint: 'SHA256:test-fingerprint',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

// The Stripe customer baked into the JWT at login and the account the session is
// actually operating in. Kept as different strings: a route reading the wrong
// one cannot pass an assertion written against the other.
export const JWT_CUSTOMER_ID = 'cus_jwt_identity';
export const OPERATING_ACCOUNT_ID = 'cus_operating_account';
export const OPERATING_HOURLY_ID = 'cus_operating_hourly';

export interface AuthContextOverrides {
  accountId?: string;
  hourlyCustomerId?: string | null;
  email?: string;
  jwtCustomerId?: string;
  teamId?: string | undefined;
  customer?: Record<string, unknown>;
  can?: boolean;
  stripe?: unknown;
}

// Stand-in for getAuthenticatedCustomer()'s return value. `can` is a flat
// boolean here because these routes gate through requirePermission, not can().
export function authContext(o: AuthContextOverrides = {}) {
  const accountId = o.accountId ?? OPERATING_ACCOUNT_ID;
  const email = o.email ?? 'member@example.com';
  return {
    payload: {
      email,
      customerId: o.jwtCustomerId ?? JWT_CUSTOMER_ID,
      userId: 'user_1',
      activeAccountId: accountId,
    },
    customer: { id: accountId, email: 'owner@example.com', name: 'Owner', metadata: {}, ...o.customer },
    teamId: 'teamId' in o ? o.teamId : 'team_1',
    allTeamIds: ['team_1'],
    stripe: o.stripe,
    accountId,
    hourlyCustomerId: 'hourlyCustomerId' in o ? o.hourlyCustomerId! : null,
    membership: { userId: 'user_1', role: 'owner', isOwner: true, revokedAt: null },
    can: () => o.can ?? true,
  };
}
