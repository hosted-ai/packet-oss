import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getDefaultPolicies,
  getDefaultPoliciesSync,
  getDefaultBaremetalPolicies,
  clearDefaultPoliciesCache,
  FALLBACK_POLICIES,
} from "@/lib/hostedai/default-policies";
import * as client from "@/lib/hostedai/client";

// Mock the hostedaiRequest function
vi.mock("@/lib/hostedai/client", () => ({
  hostedaiRequest: vi.fn(),
}));

describe("Default Policies", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearDefaultPoliciesCache();
    vi.clearAllMocks();
  });

  describe("getDefaultPolicies", () => {
    it("should fetch policies from API on first call", async () => {
      const mockResponse = [
        {
          type: "instance-type",
          id: "inst-123",
          name: "Default Instance Type",
        },
        { type: "service", id: "svc-456", name: "Default Service" },
        { type: "image", id: "img-789", name: "Default Image" },
        { type: "resource", id: "res-012", name: "Default Resource" },
        { type: "pricing", id: "price-345", name: "Default Pricing" },
      ];

      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(mockResponse);

      const policies = await getDefaultPolicies();

      expect(client.hostedaiRequest).toHaveBeenCalledWith(
        "GET",
        "/policy/defaults?nature=general",
      );
      expect(policies).toEqual({
        instanceType: "inst-123",
        service: "svc-456",
        image: "img-789",
        resource: "res-012",
        pricing: "price-345",
      });
    });

    it("should return cached policies on subsequent calls", async () => {
      const mockResponse = [
        {
          type: "instance-type",
          id: "inst-123",
          name: "Default Instance Type",
        },
        { type: "service", id: "svc-456", name: "Default Service" },
        { type: "image", id: "img-789", name: "Default Image" },
        { type: "resource", id: "res-012", name: "Default Resource" },
        { type: "pricing", id: "price-345", name: "Default Pricing" },
      ];

      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(mockResponse);

      // First call
      await getDefaultPolicies();
      expect(client.hostedaiRequest).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const policies = await getDefaultPolicies();
      expect(client.hostedaiRequest).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(policies.instanceType).toBe("inst-123");
    });

    it("should fall back to hardcoded values if API fails", async () => {
      vi.spyOn(client, "hostedaiRequest").mockRejectedValue(
        new Error("API Error"),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      const policies = await getDefaultPolicies();

      expect(policies).toEqual(FALLBACK_POLICIES);
      expect(console.error).toHaveBeenCalled();
    });

    it("should fall back to hardcoded values if response is invalid", async () => {
      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(null);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const policies = await getDefaultPolicies();

      expect(policies).toEqual(FALLBACK_POLICIES);
    });

    it("should fall back if required policies are missing", async () => {
      const incompleteResponse = [
        {
          type: "instance-type",
          id: "inst-123",
          name: "Default Instance Type",
        },
        { type: "service", id: "svc-456", name: "Default Service" },
        // Missing image, resource, pricing
      ];

      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(incompleteResponse);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const policies = await getDefaultPolicies();

      expect(policies).toEqual(FALLBACK_POLICIES);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("getDefaultPoliciesSync", () => {
    it("should return fallback immediately if cache is empty", () => {
      const policies = getDefaultPoliciesSync();
      expect(policies).toEqual(FALLBACK_POLICIES);
    });

    it("should return cached policies if available", async () => {
      const mockResponse = [
        {
          type: "instance-type",
          id: "inst-123",
          name: "Default Instance Type",
        },
        { type: "service", id: "svc-456", name: "Default Service" },
        { type: "image", id: "img-789", name: "Default Image" },
        { type: "resource", id: "res-012", name: "Default Resource" },
        { type: "pricing", id: "price-345", name: "Default Pricing" },
      ];

      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(mockResponse);

      // Populate cache
      await getDefaultPolicies();

      // Get sync should return cached
      const policies = getDefaultPoliciesSync();
      expect(policies.instanceType).toBe("inst-123");
    });
  });

  describe("clearDefaultPoliciesCache", () => {
    it("should clear the cache", async () => {
      const mockResponse = [
        {
          type: "instance-type",
          id: "inst-123",
          name: "Default Instance Type",
        },
        { type: "service", id: "svc-456", name: "Default Service" },
        { type: "image", id: "img-789", name: "Default Image" },
        { type: "resource", id: "res-012", name: "Default Resource" },
        { type: "pricing", id: "price-345", name: "Default Pricing" },
      ];

      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(mockResponse);

      // Populate cache
      await getDefaultPolicies();
      expect(client.hostedaiRequest).toHaveBeenCalledTimes(1);

      // Clear cache
      clearDefaultPoliciesCache();

      // Next call should fetch again
      await getDefaultPolicies();
      expect(client.hostedaiRequest).toHaveBeenCalledTimes(2);
    });
  });

  // PA-353 — baremetal-nature defaults for team creation. No hardcoded
  // fallback: a wrong baremetal ID would 400 the whole team creation, so
  // callers must treat null as "skip the baremetal block".
  describe("getDefaultBaremetalPolicies (PA-353)", () => {
    const mockResponse = [
      {
        type: "instance-type",
        id: "bm-inst",
        name: "Default BM Instance Type",
      },
      { type: "service", id: "bm-svc", name: "Default BM Service" },
      { type: "image", id: "bm-img", name: "Default BM Image" },
      { type: "resource", id: "bm-res", name: "Default BM Resource" },
      { type: "pricing", id: "bm-price", name: "Default BM Pricing" },
    ];

    it("should fetch baremetal-nature defaults from the API", async () => {
      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(mockResponse);

      const policies = await getDefaultBaremetalPolicies();

      expect(client.hostedaiRequest).toHaveBeenCalledWith(
        "GET",
        "/policy/defaults?nature=baremetal",
      );
      expect(policies).toEqual({
        instanceType: "bm-inst",
        service: "bm-svc",
        image: "bm-img",
        resource: "bm-res",
        pricing: "bm-price",
      });
    });

    it("should cache baremetal defaults on subsequent calls", async () => {
      vi.spyOn(client, "hostedaiRequest").mockResolvedValue(mockResponse);

      await getDefaultBaremetalPolicies();
      await getDefaultBaremetalPolicies();

      expect(client.hostedaiRequest).toHaveBeenCalledTimes(1);
    });

    it("should return null (no hardcoded fallback) when the API fails", async () => {
      vi.spyOn(client, "hostedaiRequest").mockRejectedValue(
        new Error("API Error"),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      const policies = await getDefaultBaremetalPolicies();

      expect(policies).toBeNull();
    });

    it("should return null when required baremetal policies are missing", async () => {
      vi.spyOn(client, "hostedaiRequest").mockResolvedValue([
        { type: "resource", id: "bm-res", name: "Default BM Resource" },
      ]);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const policies = await getDefaultBaremetalPolicies();

      expect(policies).toBeNull();
    });
  });

  describe("FALLBACK_POLICIES", () => {
    it("should have all required policy IDs", () => {
      expect(FALLBACK_POLICIES).toHaveProperty("pricing");
      expect(FALLBACK_POLICIES).toHaveProperty("resource");
      expect(FALLBACK_POLICIES).toHaveProperty("service");
      expect(FALLBACK_POLICIES).toHaveProperty("instanceType");
      expect(FALLBACK_POLICIES).toHaveProperty("image");

      // Verify they're all non-empty strings
      expect(FALLBACK_POLICIES.pricing).toBeTruthy();
      expect(FALLBACK_POLICIES.resource).toBeTruthy();
      expect(FALLBACK_POLICIES.service).toBeTruthy();
      expect(FALLBACK_POLICIES.instanceType).toBeTruthy();
      expect(FALLBACK_POLICIES.image).toBeTruthy();
    });
  });
});
