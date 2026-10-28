// Deepening tests for src/lib/scenarios.ts — exercises the REAL scenario
// management logic (get-or-create with settings reuse, the "invalid scenario
// name" lookup-by-name fallback, best-effort assign/unassign swallowing errors,
// the bare-metal random-suffix retry loop, and category scenario sync).
//
// Boundary mocks: @/lib/settings, @/lib/hostedai (barrel), @/lib/prisma,
// @/lib/branding, @/lib/hostedai/client. The module under test is real.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  listScenarios: vi.fn(),
  createScenario: vi.fn(),
  assignServiceToScenario: vi.fn(),
  unassignServiceFromScenario: vi.fn(),
  getHAIService: vi.fn(),
  updateHAIService: vi.fn(),
  clearCache: vi.fn(),
  gpuCategoryFindMany: vi.fn(),
  getBrandName: vi.fn(() => "Packet"),
  getAppUrl: vi.fn(() => "https://app.test"),
}));

vi.mock("@/lib/settings", () => ({ getSetting: h.getSetting, setSetting: h.setSetting }));
vi.mock("@/lib/hostedai", () => ({
  listScenarios: h.listScenarios,
  createScenario: h.createScenario,
  assignServiceToScenario: h.assignServiceToScenario,
  unassignServiceFromScenario: h.unassignServiceFromScenario,
  getHAIService: h.getHAIService,
  updateHAIService: h.updateHAIService,
}));
vi.mock("@/lib/hostedai/client", () => ({ clearCache: h.clearCache }));
vi.mock("@/lib/prisma", () => ({ prisma: { gpuCategory: { findMany: h.gpuCategoryFindMany } } }));
vi.mock("@/lib/branding", () => ({ getBrandName: h.getBrandName, getAppUrl: h.getAppUrl }));

import {
  getGpuScenarioId,
  getAppsScenarioId,
  assignGpuService,
  unassignGpuService,
  assignAppService,
  getBaremetalScenarioId,
  assignBaremetalService,
  unassignBaremetalService,
  createCategoryScenario,
  syncServiceScenarios,
  clearServiceCategoryScenarios,
} from "@/lib/scenarios";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getGpuScenarioId / getAppsScenarioId", () => {
  it("returns the persisted setting without creating a new scenario", async () => {
    h.getSetting.mockResolvedValue("existing-gpu-id");
    const id = await getGpuScenarioId();
    expect(id).toBe("existing-gpu-id");
    expect(h.createScenario).not.toHaveBeenCalled();
  });

  it("creates and persists a scenario when no setting exists", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockResolvedValue({ id: "new-gpu-id" });
    const id = await getGpuScenarioId();
    expect(id).toBe("new-gpu-id");
    expect(h.createScenario).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Packet GPU Provisioning" })
    );
    expect(h.setSetting).toHaveBeenCalledWith("packet_gpu_scenario_id", "new-gpu-id");
  });

  it("looks up by name when HAI rejects with 'invalid scenario name'", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockRejectedValue(new Error("invalid scenario name (already exists)"));
    h.listScenarios.mockResolvedValue([
      { id: "other", name: "Other" },
      { id: "found-apps-id", name: "Packet Apps" },
    ]);
    const id = await getAppsScenarioId();
    expect(id).toBe("found-apps-id");
    expect(h.setSetting).toHaveBeenCalledWith("packet_apps_scenario_id", "found-apps-id");
  });

  it("rethrows when create fails for a non-name reason", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockRejectedValue(new Error("HAI 500 internal"));
    await expect(getGpuScenarioId()).rejects.toThrow("HAI 500 internal");
  });

  it("rethrows the name error when the by-name lookup finds nothing", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockRejectedValue(new Error("invalid scenario name"));
    h.listScenarios.mockResolvedValue([{ id: "x", name: "Unrelated" }]);
    await expect(getGpuScenarioId()).rejects.toThrow("invalid scenario name");
  });
});

describe("assignGpuService / unassignGpuService (best-effort)", () => {
  it("assigns the service to the resolved GPU scenario", async () => {
    h.getSetting.mockResolvedValue("gpu-id");
    await assignGpuService("svc-1");
    expect(h.assignServiceToScenario).toHaveBeenCalledWith("svc-1", "gpu-id");
  });

  it("swallows assignment errors (never throws)", async () => {
    h.getSetting.mockResolvedValue("gpu-id");
    h.assignServiceToScenario.mockRejectedValue(new Error("HAI down"));
    await expect(assignGpuService("svc-1")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("unassigns the service from the GPU scenario", async () => {
    h.getSetting.mockResolvedValue("gpu-id");
    await unassignGpuService("svc-2");
    expect(h.unassignServiceFromScenario).toHaveBeenCalledWith("svc-2", "gpu-id");
  });

  it("swallows errors during apps assignment too", async () => {
    h.getSetting.mockResolvedValue("apps-id");
    h.assignServiceToScenario.mockRejectedValue(new Error("nope"));
    await expect(assignAppService("svc-3")).resolves.toBeUndefined();
  });
});

describe("getBaremetalScenarioId", () => {
  it("returns the persisted id without minting a new one", async () => {
    h.getSetting.mockResolvedValue("bm-existing");
    expect(await getBaremetalScenarioId()).toBe("bm-existing");
    expect(h.createScenario).not.toHaveBeenCalled();
  });

  it("mints a prefixed random-suffix scenario and persists it", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockResolvedValue({ id: "bm-new" });
    const id = await getBaremetalScenarioId();
    expect(id).toBe("bm-new");
    const arg = h.createScenario.mock.calls[0][0];
    expect(arg.name).toMatch(/^Packet Bare Metal - [0-9a-f]{6}$/);
    expect(arg.description).toContain("https://app.test");
    expect(h.setSetting).toHaveBeenCalledWith("packet_baremetal_scenario_id", "bm-new");
  });

  it("retries on a name collision then succeeds", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario
      .mockRejectedValueOnce(new Error("invalid scenario name"))
      .mockResolvedValueOnce({ id: "bm-second" });
    const id = await getBaremetalScenarioId();
    expect(id).toBe("bm-second");
    expect(h.createScenario).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting all 3 attempts", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockRejectedValue(new Error("invalid scenario name"));
    await expect(getBaremetalScenarioId()).rejects.toThrow("invalid scenario name");
    expect(h.createScenario).toHaveBeenCalledTimes(3);
  });

  it("breaks immediately (no retry) on a non-name error", async () => {
    h.getSetting.mockResolvedValue(null);
    h.createScenario.mockRejectedValue(new Error("network"));
    await expect(getBaremetalScenarioId()).rejects.toThrow("network");
    expect(h.createScenario).toHaveBeenCalledTimes(1);
  });
});

describe("assign/unassignBaremetalService membership (PUT-based)", () => {
  it("adds the scenario to the service's scenarios array when absent", async () => {
    h.getSetting.mockResolvedValue("bm-id");
    h.getHAIService.mockResolvedValue({ scenarios: ["other-scn"] });
    await assignBaremetalService("svc-bm");
    expect(h.updateHAIService).toHaveBeenCalledWith("svc-bm", {
      scenarios: ["other-scn", "bm-id"],
    });
  });

  it("no-ops when the service is already a member", async () => {
    h.getSetting.mockResolvedValue("bm-id");
    h.getHAIService.mockResolvedValue({ scenarios: ["bm-id"] });
    await assignBaremetalService("svc-bm");
    expect(h.updateHAIService).not.toHaveBeenCalled();
  });

  it("removes the scenario on unassign", async () => {
    h.getSetting.mockResolvedValue("bm-id");
    h.getHAIService.mockResolvedValue({ scenarios: ["bm-id", "keep-me"] });
    await unassignBaremetalService("svc-bm");
    expect(h.updateHAIService).toHaveBeenCalledWith("svc-bm", { scenarios: ["keep-me"] });
  });

  it("swallows errors (best-effort) and never throws", async () => {
    h.getSetting.mockResolvedValue("bm-id");
    h.getHAIService.mockRejectedValue(new Error("svc gone"));
    await expect(assignBaremetalService("svc-bm")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("createCategoryScenario", () => {
  it("creates a 'Packet GPU - <name>' scenario and returns its id", async () => {
    h.createScenario.mockResolvedValue({ id: "cat-id" });
    const id = await createCategoryScenario("Inference", "inference");
    expect(id).toBe("cat-id");
    expect(h.createScenario).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Packet GPU - Inference" })
    );
  });

  // HAI's ScenarioNameRegex rejects anything else, and the create is what
  // gates the whole category row.
  it("never builds a name HAI would reject", async () => {
    h.createScenario.mockResolvedValue({ id: "cat-id" });
    await createCategoryScenario("A100 (80GB)/SXM", "a100");
    const { name } = h.createScenario.mock.calls[0][0];
    expect(name).toMatch(/^[A-Za-z0-9 _-]+$/);
    expect(name).toBe("Packet GPU - A100 -80GB--SXM");
  });

  it("looks up by name on 'invalid scenario name'", async () => {
    h.createScenario.mockRejectedValue(new Error("invalid scenario name"));
    h.listScenarios.mockResolvedValue([{ id: "existing-cat", name: "Packet GPU - Inference" }]);
    const id = await createCategoryScenario("Inference", "inference");
    expect(id).toBe("existing-cat");
  });

  it("returns null on any other failure", async () => {
    h.createScenario.mockRejectedValue(new Error("boom"));
    expect(await createCategoryScenario("X", "x")).toBeNull();
  });

  it("returns null when the name lookup finds nothing", async () => {
    h.createScenario.mockRejectedValue(new Error("invalid scenario name"));
    h.listScenarios.mockResolvedValue([]);
    expect(await createCategoryScenario("X", "x")).toBeNull();
  });
});

describe("syncServiceScenarios", () => {
  it("preserves non-category scenarios and adds the resolved category ones", async () => {
    h.gpuCategoryFindMany
      // first call: resolve scenarioIds for the requested categories
      .mockResolvedValueOnce([
        { id: "c1", scenarioId: "scn-a", name: "A" },
        { id: "c2", scenarioId: "scn-b", name: "B" },
      ])
      // second call: ALL category scenario ids (to strip stale ones)
      .mockResolvedValueOnce([{ scenarioId: "scn-a" }, { scenarioId: "scn-b" }, { scenarioId: "scn-old" }]);
    h.getHAIService.mockResolvedValue({ scenarios: ["non-cat", "scn-old"] });

    await syncServiceScenarios("svc-x", ["c1", "c2"]);

    const arg = h.updateHAIService.mock.calls[0][1];
    expect(arg.scenarios).toContain("non-cat"); // preserved
    expect(arg.scenarios).toContain("scn-a");
    expect(arg.scenarios).toContain("scn-b");
    expect(arg.scenarios).not.toContain("scn-old"); // stale category scn removed
  });

  it("skips the update when no category resolves to a scenarioId", async () => {
    h.gpuCategoryFindMany.mockResolvedValueOnce([{ id: "c1", scenarioId: null, name: "A" }]);
    await syncServiceScenarios("svc-y", ["c1"]);
    expect(h.updateHAIService).not.toHaveBeenCalled();
  });

  it("swallows errors (best-effort)", async () => {
    h.gpuCategoryFindMany.mockRejectedValue(new Error("db error"));
    await expect(syncServiceScenarios("svc-z", ["c1"])).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("clearServiceCategoryScenarios", () => {
  it("strips only Packet category scenarios, keeping others", async () => {
    h.getHAIService.mockResolvedValue({ scenarios: ["scn-cat", "keep"] });
    h.gpuCategoryFindMany.mockResolvedValue([{ scenarioId: "scn-cat" }]);
    await clearServiceCategoryScenarios("svc-c");
    expect(h.updateHAIService).toHaveBeenCalledWith("svc-c", { scenarios: ["keep"] });
  });

  it("swallows errors", async () => {
    h.getHAIService.mockRejectedValue(new Error("nope"));
    await expect(clearServiceCategoryScenarios("svc-c")).resolves.toBeUndefined();
  });
});
