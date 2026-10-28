// PA-132: regression coverage for uploadRecipe's TUS 409 recovery.
//
// Background: HAI's TUS init rejects a duplicate recipe using a GLOBAL check
// (name+version+repository_id IS NULL), but GET /api/recipes/templates is
// PERMISSION-FILTERED — a stale local recipe can exist (blocking re-upload with
// a 409) yet be invisible to the admin role the dashboard uses. The old code
// looked the recipe up in that filtered list and, finding nothing, threw
// "TUS init failed (409)". The fix: when the 409'd recipe isn't visible,
// re-upload under a unique version to mint a fresh, role-visible template.
//
// The compress step (execSync/tar/fs) is stubbed so the real uploadRecipe TUS
// orchestration is driven through a routed global fetch. The rest of recipes.ts
// (listing / service creation) is covered in recipes.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  hostedaiRequest: vi.fn(),
  getAdminCredentials: vi.fn(),
  execSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("@/lib/hostedai/client", () => ({ hostedaiRequest: h.hostedaiRequest }));
vi.mock("@/lib/gpuaas-admin/client", () => ({ getAdminCredentials: h.getAdminCredentials }));
vi.mock("child_process", () => ({ execSync: h.execSync }));
vi.mock("fs", () => ({ existsSync: h.existsSync, statSync: h.statSync, readFileSync: h.readFileSync }));

import { uploadRecipe } from "@/lib/hostedai/recipes";

const ADMIN = "http://admin";
const RECOVERY_TS = 1_700_000_000_000; // Date.now() is pinned so the unique version is predictable

type Resp = Partial<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string>; headers: { get: (h: string) => string | null } }>;

/**
 * Build a routed fetch. `templatesQueue` supplies the successive JSON bodies
 * returned by GET /api/recipes/templates (pre-delete, then any later lookups);
 * `uploadStatuses` supplies the successive TUS-init POST outcomes.
 */
function routedFetch(opts: {
  templatesQueue: Array<Array<{ id: number; name: string; version?: string }>>;
  uploadStatuses: Array<"409" | "201">;
  deleteResp?: Resp;
}) {
  let getIdx = 0;
  let postIdx = 0;
  const calls = { getTemplates: 0, postUpload: 0, patch: 0, delete: 0 };
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const u = String(url);
    if (u.endsWith("/api/login") && method === "POST") {
      return { ok: true, status: 200, json: async () => ({ token: "tok" }) } as Resp;
    }
    if (u.endsWith("/api/recipes/templates/upload/") && method === "POST") {
      const status = opts.uploadStatuses[postIdx++];
      calls.postUpload++;
      if (status === "409") {
        return { ok: false, status: 409, text: async () => "Recipe open-webui version latest already exists." } as Resp;
      }
      return { ok: true, status: 201, headers: { get: (hd: string) => (hd === "Location" ? "/files/abc" : null) } } as Resp;
    }
    if (u.includes("/files/abc") && method === "PATCH") {
      calls.patch++;
      return { ok: true, status: 204 } as Resp;
    }
    if (/\/api\/recipes\/templates\/\d+$/.test(u) && method === "DELETE") {
      calls.delete++;
      return (opts.deleteResp ?? { ok: true, status: 204 }) as Resp;
    }
    if (u.endsWith("/api/recipes/templates") && method === "GET") {
      calls.getTemplates++;
      const body = opts.templatesQueue[Math.min(getIdx, opts.templatesQueue.length - 1)];
      getIdx++;
      return { ok: true, status: 200, json: async () => body } as Resp;
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  });
  return { fetchMock, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(RECOVERY_TS);

  h.getAdminCredentials.mockResolvedValue({ url: ADMIN, username: "u", password: "p" });
  // compressRecipe: recipe dir exists, infra dir does not; mktemp returns a path.
  h.existsSync.mockImplementation((p: string) => String(p).includes("packet_recipes"));
  h.execSync.mockImplementation((cmd: string) => (String(cmd).includes("mktemp") ? "/tmp/fake-recipe\n" : ""));
  h.statSync.mockReturnValue({ size: 1024 });
  h.readFileSync.mockReturnValue(Buffer.from("archive-bytes"));
  // user-panel sync poll resolves immediately (non-zero id → findRecipeByName truthy)
  h.hostedaiRequest.mockResolvedValue([{ id: 1, name: "open-webui" }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uploadRecipe — TUS 409 recovery (PA-132)", () => {
  it("uploads normally when there is no conflict", async () => {
    const { fetchMock, calls } = routedFetch({
      templatesQueue: [
        [], // pre-delete: nothing visible
        [{ id: 7, name: "open-webui", version: "latest" }], // post-upload lookup
      ],
      uploadStatuses: ["201"],
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = await uploadRecipe("open-webui");
    expect(id).toBe(7);
    expect(calls.postUpload).toBe(1); // no retry needed
  });

  it("reuses the existing recipe when a 409 recipe IS visible to the admin role", async () => {
    const { fetchMock, calls } = routedFetch({
      templatesQueue: [
        [], // pre-delete: nothing visible (race — it appears between delete and init)
        [{ id: 55, name: "open-webui", version: "latest" }], // 409 fallback lookup finds it
      ],
      uploadStatuses: ["409"],
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = await uploadRecipe("open-webui");
    expect(id).toBe(55);
    expect(calls.postUpload).toBe(1); // reused, did NOT re-upload
  });

  it("re-uploads under a unique version when the 409 recipe is INVISIBLE (the bug)", async () => {
    const { fetchMock, calls } = routedFetch({
      templatesQueue: [
        [], // pre-delete: invisible → nothing to delete
        [], // 409 fallback lookup: still invisible
        [{ id: 99, name: "open-webui", version: `latest-${RECOVERY_TS}` }], // fresh upload IS visible
      ],
      uploadStatuses: ["409", "201"], // first init 409s, recovery init succeeds
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = await uploadRecipe("open-webui");
    expect(id).toBe(99);
    expect(calls.postUpload).toBe(2); // retried with a new version
    expect(calls.patch).toBe(1); // the recovery upload actually sent data
  });

  it("surfaces a clear error when an existing template can't be deleted (pod-associated)", async () => {
    const { fetchMock } = routedFetch({
      templatesQueue: [
        [{ id: 3, name: "open-webui", version: "latest" }], // pre-delete finds a visible one
      ],
      uploadStatuses: [],
      deleteResp: { ok: false, status: 400, text: async () => '{"errors":["Recipe template is associated with a pod"],"result":"FAILURE"}' },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadRecipe("open-webui")).rejects.toThrow(/associated pods/i);
  });
});
