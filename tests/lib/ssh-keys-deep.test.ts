// Deepening tests for src/lib/ssh-keys.ts — complementary to the shallow
// tests/lib/ssh-keys.test.ts (which vi.spyOns the module and asserts the mock).
// This file imports the REAL functions and drives the uncovered branches:
//   * calculateFingerprint / validatePublicKey edge cases
//   * addSSHKey end-to-end with a mocked Prisma boundary (validation throw,
//     duplicate-fingerprint throw, trims, userId default)
//   * getSSHKeys / getSSHKey / deleteSSHKey query shapes
//   * injectServerKeyUsingSSHInfo's command-parse error path (no SSH spawned)
//
// Boundary mocks: @/lib/prisma and @/lib/ssh-validation. The module under test
// is imported for real.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  del: vi.fn(),
  validateSSHParams: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sSHKey: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      create: h.create,
      delete: h.del,
    },
  },
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: h.validateSSHParams }));

import {
  calculateFingerprint,
  validatePublicKey,
  getSSHKeys,
  getSSHKey,
  addSSHKey,
  deleteSSHKey,
  injectServerKeyUsingSSHInfo,
} from "@/lib/ssh-keys";

// A real, base64-decodable RSA-style public key body
const RSA_KEY = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC1example user@host";
const ED_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLs user@host";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("calculateFingerprint", () => {
  it("returns a 16-pair colon-joined MD5 hex string", () => {
    const fp = calculateFingerprint(RSA_KEY);
    expect(fp).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/);
  });

  it("is deterministic for the same key but differs across keys", () => {
    expect(calculateFingerprint(RSA_KEY)).toBe(calculateFingerprint(RSA_KEY));
    expect(calculateFingerprint(RSA_KEY)).not.toBe(calculateFingerprint(ED_KEY));
  });

  it("throws on a malformed key (fewer than 2 fields)", () => {
    expect(() => calculateFingerprint("ssh-rsa")).toThrow("Invalid SSH public key format");
  });
});

describe("validatePublicKey", () => {
  it("accepts every supported key type", () => {
    for (const type of [
      "ssh-rsa",
      "ssh-ed25519",
      "ssh-dss",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
    ]) {
      const res = validatePublicKey(`${type} AAAAB3NzaC1 comment`);
      expect(res.valid).toBe(true);
      expect(res.type).toBe(type);
    }
  });

  it("rejects an unsupported type", () => {
    const res = validatePublicKey("ssh-weird AAAAB3 comment");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Unsupported key type: ssh-weird");
  });

  it("rejects an incomplete key (no key data)", () => {
    expect(validatePublicKey("ssh-rsa").valid).toBe(false);
    expect(validatePublicKey("").valid).toBe(false);
  });
});

describe("getSSHKeys", () => {
  it("queries by customer ordered by createdAt desc", async () => {
    const keys = [{ id: "k1" }, { id: "k2" }];
    h.findMany.mockResolvedValue(keys);
    const result = await getSSHKeys("cus_1");
    expect(result).toBe(keys);
    expect(h.findMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_1" },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("getSSHKey", () => {
  it("scopes findFirst by id AND customer (ownership)", async () => {
    h.findFirst.mockResolvedValue({ id: "k1" });
    await getSSHKey("k1", "cus_1");
    expect(h.findFirst).toHaveBeenCalledWith({ where: { id: "k1", stripeCustomerId: "cus_1" } });
  });

  it("returns null when not found / not owned", async () => {
    h.findFirst.mockResolvedValue(null);
    expect(await getSSHKey("k1", "cus_wrong")).toBeNull();
  });
});

describe("addSSHKey", () => {
  it("throws the format error for a single-field key, without touching the DB", async () => {
    await expect(
      addSSHKey({ stripeCustomerId: "cus_1", name: "Bad", publicKey: "not-a-key" })
    ).rejects.toThrow("Invalid SSH public key format");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("throws the unsupported-type error for a two-field key with a bad type", async () => {
    await expect(
      addSSHKey({ stripeCustomerId: "cus_1", name: "Bad", publicKey: "ssh-weird AAAA comment" })
    ).rejects.toThrow("Unsupported key type: ssh-weird");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("throws when the same fingerprint already exists for the customer", async () => {
    h.findFirst.mockResolvedValue({ name: "Existing Key" });
    await expect(
      addSSHKey({ stripeCustomerId: "cus_1", name: "Dup", publicKey: RSA_KEY })
    ).rejects.toThrow('already added as "Existing Key"');
    expect(h.create).not.toHaveBeenCalled();
  });

  it("creates with trimmed name/key, computed fingerprint and userId defaulted to null", async () => {
    h.findFirst.mockResolvedValue(null);
    h.create.mockResolvedValue({ id: "k_new" });
    await addSSHKey({
      stripeCustomerId: "cus_1",
      name: "  My Key  ",
      publicKey: `  ${RSA_KEY}  `,
    });
    const data = h.create.mock.calls[0][0].data;
    expect(data.name).toBe("My Key");
    expect(data.publicKey).toBe(RSA_KEY);
    expect(data.userId).toBeNull();
    expect(data.fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/);
    // dedupe check ran scoped to the customer + computed fingerprint
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_1", fingerprint: data.fingerprint },
    });
  });

  it("attributes the key to a userId when supplied", async () => {
    h.findFirst.mockResolvedValue(null);
    h.create.mockResolvedValue({ id: "k_new" });
    await addSSHKey({ stripeCustomerId: "cus_1", name: "K", publicKey: RSA_KEY, userId: "user_42" });
    expect(h.create.mock.calls[0][0].data.userId).toBe("user_42");
  });
});

describe("deleteSSHKey", () => {
  it("deletes scoped to id + customer", async () => {
    h.del.mockResolvedValue(undefined);
    await deleteSSHKey("k1", "cus_1");
    expect(h.del).toHaveBeenCalledWith({ where: { id: "k1", stripeCustomerId: "cus_1" } });
  });
});

describe("injectServerKeyUsingSSHInfo (parse path)", () => {
  it("returns a failure result when the SSH command has no user@host (no spawn)", async () => {
    const res = await injectServerKeyUsingSSHInfo("ssh --no-host-here", "pw");
    expect(res.success).toBe(false);
    expect(res.output).toContain("missing user@host");
    // never reached the SSH param validation
    expect(h.validateSSHParams).not.toHaveBeenCalled();
  });
});
