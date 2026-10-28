import { describe, it, expect, vi, beforeEach } from 'vitest';

// Boundary mocks: the hosted.ai HTTP client and the default-policies lookup.
vi.mock('@/lib/hostedai/client', () => ({
  hostedaiRequest: vi.fn(),
}));
vi.mock('@/lib/hostedai/default-policies', () => ({
  getDefaultPoliciesSync: () => ({ resource: 'default-policy-id' }),
}));

import {
  syncTeamsToDefaultPolicy,
  addRegionToResourcePolicy,
} from '@/lib/hostedai/policies';
import type { ResourcePolicy } from '@/lib/hostedai/policies';
import { hostedaiRequest } from '@/lib/hostedai/client';

const DEFAULT_POLICY_ID = 'default-policy-id';
const mockRequest = vi.mocked(hostedaiRequest);

// A policy whose region 75 is restricted — the exact shape that a lossy
// whole-policy PUT would corrupt (region 75 carries allotted_rgs that our read
// model can't round-trip). PA-272.
function policyWithRestrictedRegion(): ResourcePolicy {
  return {
    id: 'p1',
    name: 'Default',
    is_system_defined: true,
    is_default: true,
    globals: [],
    regions: [
      {
        region_id: 75,
        region_name: 'uk-south',
        access: 'limited',
        region_details: {
          id: 75,
          region_name: 'uk-south',
          address: '',
          city: '',
          country: '',
          country_code: 'GB',
        },
        allotted_rgs: [{ id: 1, name: 'rg-a', access: 'limited' }],
      },
    ],
    teams: [],
    created_at: '',
    updated_at: '',
  };
}

/** Route GET to a fixed policy; everything else (POST/PUT) resolves empty. */
function mockGetPolicy(policy: ResourcePolicy): void {
  mockRequest.mockImplementation(async (method: string) =>
    (method === 'GET' ? policy : {}) as never
  );
}

const putCalls = () => mockRequest.mock.calls.filter((c) => c[0] === 'PUT');

describe('syncTeamsToDefaultPolicy (PA-272)', () => {
  beforeEach(() => mockRequest.mockReset());

  it('assigns each team via the dedicated assign-team endpoint', async () => {
    mockRequest.mockResolvedValue({} as never);

    await syncTeamsToDefaultPolicy(['team-a', 'team-b']);

    expect(mockRequest).toHaveBeenCalledWith('POST', '/resource-policy/assign-team', {
      policy_id: DEFAULT_POLICY_ID,
      team_id: 'team-a',
    });
    expect(mockRequest).toHaveBeenCalledWith('POST', '/resource-policy/assign-team', {
      policy_id: DEFAULT_POLICY_ID,
      team_id: 'team-b',
    });
  });

  it('never issues a whole-policy PUT or GET to add a team (the regression)', async () => {
    mockRequest.mockResolvedValue({} as never);

    await syncTeamsToDefaultPolicy(['team-a']);

    expect(putCalls()).toHaveLength(0);
    expect(mockRequest.mock.calls.some((c) => c[0] === 'GET')).toBe(false);
  });

  it('is idempotent: swallows the "already linked" 400', async () => {
    mockRequest.mockRejectedValueOnce(
      new Error('Hosted.ai API error (400): Team is already linked to this resource policy')
    );

    await expect(syncTeamsToDefaultPolicy(['team-a'])).resolves.toBeUndefined();
  });

  it('propagates other API errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Hosted.ai API error (500): boom'));

    await expect(syncTeamsToDefaultPolicy(['team-a'])).rejects.toThrow(/boom/);
  });
});

describe('addRegionToResourcePolicy (PA-272)', () => {
  beforeEach(() => mockRequest.mockReset());

  it('adds a team to an existing restricted region without any PUT', async () => {
    mockGetPolicy(policyWithRestrictedRegion());

    const added = await addRegionToResourcePolicy('p1', 75, ['team-a']);

    expect(added).toBe(false);
    // No whole-policy PUT means region 75's allotted_rgs are left untouched.
    expect(putCalls()).toHaveLength(0);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/resource-policy/assign-team', {
      policy_id: 'p1',
      team_id: 'team-a',
    });
  });

  it('PUTs to add a genuinely new region, but keeps teams out of that PUT', async () => {
    mockGetPolicy(policyWithRestrictedRegion());

    const added = await addRegionToResourcePolicy('p1', 99, ['team-a']);

    expect(added).toBe(true);
    const put = putCalls()[0];
    expect(put).toBeDefined();
    expect(put![2]).not.toHaveProperty('teams');
    expect((put![2] as { regions: unknown }).regions).toEqual([
      { region_id: 75, access: 'limited' },
      { region_id: 99, access: 'unlimited' },
    ]);
    // Team still applied — via the non-lossy endpoint, not the PUT.
    expect(mockRequest).toHaveBeenCalledWith('POST', '/resource-policy/assign-team', {
      policy_id: 'p1',
      team_id: 'team-a',
    });
  });

  it('is a pure read when the region exists and no teams are given', async () => {
    mockGetPolicy(policyWithRestrictedRegion());

    const added = await addRegionToResourcePolicy('p1', 75);

    expect(added).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0]).toBe('GET');
  });
});
