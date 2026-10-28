// Round-trip tests binding the activity writers to the activity reader.
//
// Two identity models coexist: the Stripe customer baked into the JWT
// (payload.customerId) and the operating account resolved by
// resolveOperatingContext (auth.accountId). They diverge for an invited team
// member and after /api/session/switch-account. The activity feed's `where`
// clause is its whole access decision, so writers and reader must name the same
// id — reverting either side alone leaves these tests red.
//
// @/lib/activity is deliberately NOT mocked: the store below is the only fake,
// so each test exercises the real create/findMany path end to end.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockStartInstance,
  mockStopInstance,
  mockRestartInstance,
  mockGetUnifiedInstances,
  mockGetInstanceCredentials,
  mockInjectServerKeyIntoPod,
  store,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockStartInstance: vi.fn(),
  mockStopInstance: vi.fn(),
  mockRestartInstance: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockGetInstanceCredentials: vi.fn(),
  mockInjectServerKeyIntoPod: vi.fn(),
  store: [] as Array<{
    id: string;
    customerId: string;
    type: string;
    description: string;
    metadata: string | null;
    createdAt: Date;
  }>,
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/hostedai", () => ({
  startInstance: mockStartInstance,
  stopInstance: mockStopInstance,
  restartInstance: mockRestartInstance,
  getUnifiedInstances: mockGetUnifiedInstances,
  getInstanceCredentials: mockGetInstanceCredentials,
}));
vi.mock("@/lib/ssh-keys", () => ({
  injectServerKeyIntoPod: mockInjectServerKeyIntoPod,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `evt_${store.length + 1}`,
          customerId: data.customerId as string,
          type: data.type as string,
          description: data.description as string,
          metadata: (data.metadata as string | null) ?? null,
          createdAt: new Date(),
        };
        store.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where, take }: { where: { customerId: string }; take?: number }) =>
        store.filter((e) => e.customerId === where.customerId).slice(0, take ?? 100)
      ),
    },
    podMetadata: { findFirst: vi.fn(async () => ({ displayName: "pod-1" })) },
    installedApp: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

import { GET as readActivity } from "@/app/api/account/activity/route";
import { POST as startInstanceRoute } from "@/app/api/instances/pool-subscription/[id]/start/route";
import { POST as stopInstanceRoute } from "@/app/api/instances/pool-subscription/[id]/stop/route";
import { POST as restartInstanceRoute } from "@/app/api/instances/pool-subscription/[id]/restart/route";

const TEAM_ACCOUNT = "cus_team_account";
const UNRELATED_ACCOUNT = "cus_unrelated_account";
const ID = "i-scoped";

// The JWT customer is always a different string from the operating account, so a
// test can never pass by the two happening to coincide.
function session(ownCustomerId: string, accountId: string) {
  return {
    payload: { customerId: ownCustomerId, email: `${ownCustomerId}@example.com`, userId: "u1" },
    allTeamIds: ["team_1"],
    accountId,
  };
}

const ALICE = session("cus_alice_own", TEAM_ACCOUNT);
const BOB = session("cus_bob_own", TEAM_ACCOUNT);
const OUTSIDER = session("cus_outsider_own", UNRELATED_ACCOUNT);

const WRITERS = [
  { name: "start", route: startInstanceRoute, type: "gpu_started" },
  { name: "stop", route: stopInstanceRoute, type: "gpu_stopped" },
  { name: "restart", route: restartInstanceRoute, type: "gpu_restarted" },
] as const;

function writeRequest(path: string) {
  const headers = new Headers({ authorization: "Bearer t" });
  return new Request(`http://localhost/api/instances/pool-subscription/${ID}/${path}`, {
    method: "POST",
    headers,
  }) as never;
}

function readRequest() {
  const headers = new Headers({ authorization: "Bearer t" });
  return new Request("http://localhost/api/account/activity", {
    method: "GET",
    headers,
  }) as never;
}

async function readAs(auth: ReturnType<typeof session>): Promise<Array<{ type: string }>> {
  mockGetAuthenticatedCustomer.mockResolvedValue(auth);
  const res = await readActivity(readRequest());
  expect(res.status).toBe(200);
  return (await res.json()).events;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  store.length = 0;
  mockRequirePermission.mockReturnValue(null);
  mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: ID }] });
  mockStartInstance.mockResolvedValue({});
  mockStopInstance.mockResolvedValue({});
  mockRestartInstance.mockResolvedValue({});
  mockGetInstanceCredentials.mockResolvedValue({});
  mockInjectServerKeyIntoPod.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(WRITERS)("$name writes an activity event the feed can read", ({ name, route, type }) => {
  it("is readable by another member operating the same account", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(ALICE);
    expect((await route(writeRequest(name), { params: Promise.resolve({ id: ID }) })).status).toBe(200);

    expect(store).toHaveLength(1);
    expect(store[0].customerId).toBe(TEAM_ACCOUNT);
    expect(await readAs(BOB)).toEqual([expect.objectContaining({ type })]);
  });

  it("is not readable by a session operating an unrelated account", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(ALICE);
    await route(writeRequest(name), { params: Promise.resolve({ id: ID }) });

    expect(await readAs(OUTSIDER)).toEqual([]);
  });

  it("is not attributed to the writer's own JWT customer", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(ALICE);
    await route(writeRequest(name), { params: Promise.resolve({ id: ID }) });

    expect(store.map((e) => e.customerId)).not.toContain(ALICE.payload.customerId);
    expect(await readAs(session("cus_anyone", ALICE.payload.customerId))).toEqual([]);
  });
});
