import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTeam, changeTeamPackage } from '@/lib/hostedai/teams';
import { clearDefaultPoliciesCache } from '@/lib/hostedai/default-policies';
import type { CreateTeamParams } from '@/lib/hostedai/types';

// Mock the client module
vi.mock('@/lib/hostedai/client', () => ({
  hostedaiRequest: vi.fn(),
  getApiUrl: vi.fn(async () => 'https://hai.example.com'),
}));

import { hostedaiRequest } from '@/lib/hostedai/client';

const mockRequest = vi.mocked(hostedaiRequest);

// These tests lock in the Titan↔Ariel dual-shape contract for the two team
// endpoints that Ariel broke (see "HAI Ariel compat sweep"): Ariel moved the
// flat top-level policy IDs into a nested `general` object gated by
// `has_general_policies`, and PUT /team/{id} now hard-requires `name`. We send
// BOTH shapes so the same body works on Titan (current prod) and Ariel (later).
//
// PA-353: Ariel also split policies into general/baremetal natures and does NO
// server-side defaulting — a team created with only the `general` block gets
// zero baremetal policies, so the default baremetal resource policy never
// lands. createTeam must therefore also send `has_baremetal_policies` + the
// default baremetal policy set, and changeTeamPackage must round-trip an
// existing baremetal set (Ariel 400s a PUT that says has_baremetal_policies
//=false while the team has baremetal policies assigned).

const POLICIES = {
  pricing_policy_id: 'pricing-1',
  resource_policy_id: 'resource-1',
  service_policy_id: 'service-1',
  instance_type_policy_id: 'instance-type-1',
  image_policy_id: 'image-1',
};

// GET /policy/defaults?nature=baremetal response (PA-353)
const BM_DEFAULTS_RESPONSE = [
  { type: 'resource', id: 'bm-res', name: 'Default Baremetal Resource' },
  { type: 'service', id: 'bm-svc', name: 'Default Baremetal Service' },
  { type: 'pricing', id: 'bm-price', name: 'Default Baremetal Pricing' },
  { type: 'image', id: 'bm-img', name: 'Default Baremetal Image' },
  { type: 'instance-type', id: 'bm-inst', name: 'Default Baremetal Instance Type' },
];

const BM_POLICIES = {
  pricing_policy_id: 'bm-price',
  resource_policy_id: 'bm-res',
  service_policy_id: 'bm-svc',
  instance_type_policy_id: 'bm-inst',
  image_policy_id: 'bm-img',
};

const CREATE_PARAMS: CreateTeamParams = {
  name: 'Acme Team',
  members: [{ email: 'a@example.com', role: 'team_admin' }],
  ...POLICIES,
};

function callOf(method: string) {
  const call = mockRequest.mock.calls.find((c) => c[0] === method && String(c[1]).startsWith('/team'));
  expect(call, `expected a ${method} /team call`).toBeDefined();
  return call!;
}

describe('createTeam — Titan/Ariel dual-shape policy body', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    clearDefaultPoliciesCache();
    mockRequest.mockImplementation(async (_method, path) => {
      if (String(path).startsWith('/policy/defaults')) return BM_DEFAULTS_RESPONSE as never;
      return { id: 'team-1' } as never;
    });
  });

  it('sends both flat policy keys (Titan) and nested general + has_general_policies (Ariel)', async () => {
    await createTeam(CREATE_PARAMS);

    const [, path, body] = callOf('POST');
    expect(path).toBe('/team');

    // Titan: flat top-level keys still present
    expect(body).toMatchObject(POLICIES);

    // Ariel: nested general set + gate flag
    expect(body).toMatchObject({
      has_general_policies: true,
      general: POLICIES,
    });
  });

  it('sends the default baremetal policy set gated by has_baremetal_policies (PA-353)', async () => {
    await createTeam(CREATE_PARAMS);

    const [, , body] = callOf('POST');
    expect(body).toMatchObject({
      has_baremetal_policies: true,
      baremetal: BM_POLICIES,
    });
  });

  it('creates the team general-only if baremetal defaults are unavailable (PA-353)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockImplementation(async (_method, path) => {
      if (String(path).startsWith('/policy/defaults')) throw new Error('HAI down');
      return { id: 'team-1' } as never;
    });

    await createTeam(CREATE_PARAMS);

    const [, , body] = callOf('POST');
    expect(body).not.toHaveProperty('has_baremetal_policies');
    expect(body).not.toHaveProperty('baremetal');
    expect(body).toMatchObject({ has_general_policies: true, general: POLICIES });
  });
});

describe('changeTeamPackage — Titan/Ariel dual-shape + name round-trip', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    clearDefaultPoliciesCache();
  });

  function mockHai(opts: {
    team?: unknown;
    teamError?: boolean;
    bmDefaults?: unknown;
    bmDefaultsError?: boolean;
  }) {
    mockRequest.mockImplementation(async (method, path) => {
      if (String(path).startsWith('/policy/defaults')) {
        if (opts.bmDefaultsError) throw new Error('HAI down');
        return (opts.bmDefaults ?? BM_DEFAULTS_RESPONSE) as never;
      }
      if (method === 'GET') {
        if (opts.teamError) throw new Error('HAI down');
        return opts.team as never;
      }
      return undefined as never;
    });
  }

  it('round-trips the current team name and sends both flat + nested policy shapes', async () => {
    // Titan-flat team response
    mockHai({ team: { id: 'team-9', name: 'Existing Name' } });

    await changeTeamPackage('team-9', POLICIES);

    const [, putPath, putBody] = callOf('PUT');
    expect(putPath).toBe('/team/team-9');
    // Ariel requires a non-empty name; we round-trip the existing one (no rename)
    expect(putBody).toMatchObject({ name: 'Existing Name' });
    // Titan: flat keys; Ariel: nested general + gate flag
    expect(putBody).toMatchObject({ ...POLICIES, has_general_policies: true, general: POLICIES });
  });

  it("reads the team name from Ariel's wrapped { team: ... } response shape", async () => {
    mockHai({ team: { team: { id: 'team-9', name: 'Wrapped Name' } } });

    await changeTeamPackage('team-9', POLICIES);

    const [, , putBody] = callOf('PUT');
    expect(putBody).toMatchObject({ name: 'Wrapped Name' });
  });

  it('still issues the PUT (without name) if the team lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHai({ teamError: true });

    await expect(changeTeamPackage('team-9', POLICIES)).resolves.toBeUndefined();

    const [, , putBody] = callOf('PUT');
    expect(putBody).not.toHaveProperty('name');
    expect(putBody).toMatchObject({ has_general_policies: true, general: POLICIES });
  });

  it('round-trips existing baremetal policies, filling gaps from defaults (PA-353)', async () => {
    // Team has only a baremetal resource policy (e.g. assigned by the ops
    // cron) — the PUT must send the full 5-ID baremetal set or Ariel 400s.
    mockHai({
      team: {
        team: {
          id: 'team-9',
          name: 'T',
          policy_info: {
            baremetal_resource_policy: { id: 'existing-bm-res', name: 'Assigned by cron' },
          },
        },
      },
    });

    await changeTeamPackage('team-9', POLICIES);

    const [, , putBody] = callOf('PUT');
    expect(putBody).toMatchObject({
      has_baremetal_policies: true,
      baremetal: { ...BM_POLICIES, resource_policy_id: 'existing-bm-res' },
    });
  });

  it('omits the baremetal block when defaults are unavailable and the team has none (PA-353)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHai({
      team: { team: { id: 'team-9', name: 'T', policy_info: {} } },
      bmDefaultsError: true,
    });

    await changeTeamPackage('team-9', POLICIES);

    const [, , putBody] = callOf('PUT');
    expect(putBody).not.toHaveProperty('has_baremetal_policies');
    expect(putBody).not.toHaveProperty('baremetal');
  });
});
