import { vi } from 'vitest';

export const mockStripe = {
  customers: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    del: vi.fn(),
    list: vi.fn(),
  },
  paymentIntents: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
    list: vi.fn(),
  },
  subscriptions: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(),
  },
  products: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },
  prices: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },
};

export default mockStripe;
