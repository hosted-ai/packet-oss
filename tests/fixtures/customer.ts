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
