// PA-688: the HAI node-id repair sweep, now run automatically by the DAILY
// bare-metal lifecycle cron. These pin the properties that make it safe to run
// on a schedule rather than by hand:
//
//   idempotent   — only rows with haiNodeId NULL are selected, so a resolved row
//                  is never rewritten and a second run does nothing
//   bounded      — `limit` caps rows per run, so a permanently unresolvable row
//                  can't cost unbounded API calls forever
//   dry-run safe — apply:false writes nothing
//   never guesses— only a node id from HAI's own records is written; a FAILED
//                  audit row (which still carries its target node_id) is ignored

import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  getInstance: vi.fn(),
  getLogs: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { bareMetalServer: { findMany: m.findMany, update: m.update } },
}));
vi.mock("@/lib/hostedai/baremetal", () => ({
  getBaremetalInstance: m.getInstance,
  getBaremetalAuditLogs: m.getLogs,
}));

import { backfillMissingNodeIds, nodeIdFromAuditLogs } from "@/lib/baremetal/node-ids";

function row(id: string, subId: string) {
  return {
    id,
    haiSubscriptionId: subId,
    order: { invoiceNumber: `INV-${id}`, teamId: "team-1" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.findMany.mockResolvedValue([]);
  m.update.mockResolvedValue({});
  m.getInstance.mockResolvedValue({});
  m.getLogs.mockResolvedValue([]);
});

describe("nodeIdFromAuditLogs", () => {
  it("takes the newest SUCCESSFUL row", () => {
    expect(
      nodeIdFromAuditLogs([
        { node_id: 5, status: "Success", started_at: "2026-07-01T00:00:00Z" },
        { node_id: 7, status: "Success", started_at: "2026-08-01T00:00:00Z" },
      ])
    ).toBe(7);
  });

  it("ignores a FAILED row even when it is newest", () => {
    // A failed reassignment still records its TARGET node — writing it would
    // attribute a machine the subscription never ran on.
    expect(
      nodeIdFromAuditLogs([
        { node_id: 5, status: "Success", started_at: "2026-07-01T00:00:00Z" },
        { node_id: 9, status: "Failure", started_at: "2026-08-01T00:00:00Z" },
      ])
    ).toBe(5);
  });

  it("ignores rows with an unrecognised status rather than guessing", () => {
    expect(nodeIdFromAuditLogs([{ node_id: 9, started_at: "2026-08-01T00:00:00Z" }])).toBeNull();
    expect(
      nodeIdFromAuditLogs([{ node_id: 9, status: "Pending", started_at: "2026-08-01T00:00:00Z" }])
    ).toBeNull();
  });

  it("returns null for no rows and for rows without a node id", () => {
    expect(nodeIdFromAuditLogs([])).toBeNull();
    expect(nodeIdFromAuditLogs([{ status: "Success", started_at: "2026-08-01T00:00:00Z" }])).toBeNull();
  });
});

describe("backfillMissingNodeIds", () => {
  it("only ever considers provisioned rows with a NULL node id (idempotence)", async () => {
    await backfillMissingNodeIds({ delayMs: 0 });
    const where = m.findMany.mock.calls[0][0].where;
    expect(where.haiNodeId).toBeNull();
    expect(where.haiSubscriptionId).toEqual({ not: null });
    expect(where.provisionedDate).toEqual({ not: null });
  });

  it("does nothing when there is nothing to repair", async () => {
    const r = await backfillMissingNodeIds({ apply: true, delayMs: 0 });
    expect(r).toMatchObject({ scanned: 0, written: 0 });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.getInstance).not.toHaveBeenCalled();
  });

  it("passes the cap to the query so a run can't grow unbounded", async () => {
    await backfillMissingNodeIds({ limit: 25, delayMs: 0 });
    expect(m.findMany.mock.calls[0][0].take).toBe(25);
  });

  it("writes nothing on a dry run", async () => {
    m.findMany.mockResolvedValue([row("s1", "397")]);
    m.getInstance.mockResolvedValue({ node_id: 7 });

    const r = await backfillMissingNodeIds({ apply: false, delayMs: 0 });

    expect(r.resolved).toHaveLength(1);
    expect(r.written).toBe(0);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("prefers the live subscription and skips the audit log entirely", async () => {
    m.findMany.mockResolvedValue([row("s1", "397")]);
    m.getInstance.mockResolvedValue({ node_id: 7 });

    const r = await backfillMissingNodeIds({ apply: true, delayMs: 0 });

    expect(r.resolved[0]).toMatchObject({ nodeId: 7, source: "subscription" });
    expect(r.written).toBe(1);
    expect(m.getLogs).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { haiNodeId: 7 } });
  });

  it("falls back to the audit log for a released (soft-deleted) subscription", async () => {
    m.findMany.mockResolvedValue([row("s1", "358")]);
    m.getInstance.mockRejectedValue(new Error("not found")); // HAI excludes soft-deleted
    m.getLogs.mockResolvedValue([
      { node_id: 5, status: "Success", started_at: "2026-07-20T00:00:00Z" },
    ]);

    const r = await backfillMissingNodeIds({ apply: true, delayMs: 0 });

    expect(r.resolved[0]).toMatchObject({ nodeId: 5, source: "audit-log" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { haiNodeId: 5 } });
  });

  it("reports an unresolvable row instead of writing a guess", async () => {
    m.findMany.mockResolvedValue([row("s1", "999")]);
    m.getInstance.mockRejectedValue(new Error("gone"));
    m.getLogs.mockResolvedValue([]);

    const r = await backfillMissingNodeIds({ apply: true, delayMs: 0 });

    expect(r.resolved).toHaveLength(0);
    expect(r.written).toBe(0);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].invoiceNumber).toBe("INV-s1");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("keeps going after one row fails", async () => {
    m.findMany.mockResolvedValue([row("s1", "1"), row("s2", "2")]);
    m.getInstance.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ node_id: 8 });
    m.getLogs.mockResolvedValue([]);

    const r = await backfillMissingNodeIds({ apply: true, delayMs: 0 });

    expect(r.unresolved).toHaveLength(1);
    expect(r.resolved).toHaveLength(1);
    expect(r.written).toBe(1);
  });
});
