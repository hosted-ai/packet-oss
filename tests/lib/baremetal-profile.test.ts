// Bare-metal KYC profile completeness (legal/finance mandate gate).

import { describe, it, expect } from "vitest";
import {
  isBareMetalProfileComplete,
  missingBareMetalProfileFields,
} from "@/lib/baremetal/profile";

const COMPLETE = {
  name: "Jane Doe",
  personalAddress: "1 Main St",
  country: "US",
  zipCode: "90001",
  companyName: "Acme",
  companyAddress: "1 HQ Plaza",
};

describe("isBareMetalProfileComplete", () => {
  it("true when all required fields are filled", () => {
    expect(isBareMetalProfileComplete(COMPLETE)).toBe(true);
  });

  it('accepts "N/A" in company fields (customers with no company)', () => {
    expect(
      isBareMetalProfileComplete({ ...COMPLETE, companyName: "N/A", companyAddress: "N/A" }),
    ).toBe(true);
  });

  it("false when any required field is empty, null, undefined, or whitespace", () => {
    expect(isBareMetalProfileComplete({ ...COMPLETE, name: "" })).toBe(false);
    expect(isBareMetalProfileComplete({ ...COMPLETE, personalAddress: null })).toBe(false);
    expect(isBareMetalProfileComplete({ ...COMPLETE, country: undefined })).toBe(false);
    expect(isBareMetalProfileComplete({ ...COMPLETE, zipCode: "   " })).toBe(false);
  });

  it("companyRegNumber is NOT required", () => {
    // COMPLETE has no companyRegNumber and is still complete.
    expect(isBareMetalProfileComplete(COMPLETE)).toBe(true);
  });

  it("empty profile → incomplete, all fields reported missing", () => {
    expect(isBareMetalProfileComplete({})).toBe(false);
    expect(missingBareMetalProfileFields({}).sort()).toEqual(
      ["companyAddress", "companyName", "country", "name", "personalAddress", "zipCode"].sort(),
    );
  });

  it("reports only the fields that are actually missing", () => {
    expect(
      missingBareMetalProfileFields({ ...COMPLETE, country: "", zipCode: "" }).sort(),
    ).toEqual(["country", "zipCode"]);
  });
});
