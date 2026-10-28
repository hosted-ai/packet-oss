// Blanket auth-gate test for every route under src/app/api/cron/.
//
// One parametrized suite instead of a hand-written 401 case per route, so a
// new cron endpoint that forgets the CRON_SECRET check fails CI automatically
// instead of shipping unauthenticated (anyone on the internet could otherwise
// trigger billing operations / emails). This only asserts the auth gate —
// downstream dependencies (DB, Stripe, hosted.ai / GPUaaS HTTP clients) are
// stubbed to generic empty/ok values so every route's handler can actually
// run past the gate without touching real infra. Business-logic correctness
// per route is covered by that route's own test file under tests/api/cron/.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

const CRON_DIR = path.join(process.cwd(), "src/app/api/cron");
const SECRET = "cron-auth-suite-secret";
const ORIGINAL_SECRET = process.env.CRON_SECRET;
const METHODS = ["GET", "POST"] as const;

const routes = fs
  .readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(CRON_DIR, name, "route.ts")))
  .sort();

// Generic Prisma stand-in: any `prisma.<model>.<method>()` resolves to an
// empty/neutral value by method-name shape; `$transaction` runs its callback
// against the same mock (or resolves an array of promises for the array form).
function makeModelNamespace() {
  return new Proxy(
    {},
    {
      get(_target, method) {
        const name = String(method);
        return vi.fn().mockImplementation(() => {
          if (name.startsWith("count")) return Promise.resolve(0);
          if (name.endsWith("Many")) return Promise.resolve([]);
          return Promise.resolve(null);
        });
      },
    },
  );
}

function makePrismaMock() {
  const namespaces = new Map<string, object>();
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        const key = String(prop);
        if (key.startsWith("$")) {
          return vi.fn().mockImplementation((arg: unknown) => {
            if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(proxy);
            if (Array.isArray(arg)) return Promise.all(arg);
            return Promise.resolve([]);
          });
        }
        if (!namespaces.has(key)) namespaces.set(key, makeModelNamespace());
        return namespaces.get(key);
      },
    },
  );
  return proxy;
}

// Generic Stripe stand-in: any `stripe.<namespace>.<method>()` resolves to a
// neutral value, so routes that call e.g. stripe.customers.list(...) don't
// hit the real Stripe API.
function makeStripeMock() {
  const namespaces = new Map<string, object>();
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const key = String(prop);
        if (!namespaces.has(key)) {
          namespaces.set(
            key,
            new Proxy({}, { get: () => vi.fn().mockResolvedValue({ data: [], id: "test" }) }),
          );
        }
        return namespaces.get(key);
      },
    },
  );
}

vi.mock("@/lib/prisma", () => ({ prisma: makePrismaMock() }));

const stripeClient = makeStripeMock();
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockResolvedValue(stripeClient),
  getStripeForTenant: vi.fn().mockResolvedValue(stripeClient),
  getStripeWebhookSecret: vi.fn().mockResolvedValue("whsec_test"),
}));

function makeRequest(name: string, method: string, secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  return new NextRequest(`http://localhost/api/cron/${name}`, { method, headers });
}

describe("cron endpoint auth — every route under src/app/api/cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("discovers at least the known cron routes", () => {
    // AC calls for 24+ routes; guards against the enumeration silently
    // finding nothing (e.g. a moved directory) and the suite going green
    // on zero cases.
    expect(routes.length).toBeGreaterThanOrEqual(24);
  });

  it.each(routes)("%s: rejects a request with no CRON_SECRET", async (name) => {
    const mod = await import(`@/app/api/cron/${name}/route`);
    for (const method of METHODS) {
      const handler = mod[method];
      if (!handler) continue;
      const res = await handler(makeRequest(name, method));
      expect(res.status, `${name} ${method} without a secret`).toBe(401);
    }
  });

  it.each(routes)("%s: accepts a request with the correct CRON_SECRET", async (name) => {
    const mod = await import(`@/app/api/cron/${name}/route`);
    let sawHandler = false;
    for (const method of METHODS) {
      const handler = mod[method];
      if (!handler) continue;
      sawHandler = true;
      const res = await handler(makeRequest(name, method, SECRET));
      expect(res.status, `${name} ${method} with the correct secret`).not.toBe(401);
    }
    expect(sawHandler).toBe(true);
  });
});
