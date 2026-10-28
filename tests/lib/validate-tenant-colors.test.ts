// PA-675: tenant colours are interpolated into a <style> block by TenantStyles, so
// an unvalidated value is CSS injection. The admin PATCH route accepted any string.

import { describe, it, expect } from "vitest";
import { findInvalidTenantColor } from "@/lib/tenant/validate-colors";

describe("findInvalidTenantColor", () => {
  it("accepts 6-digit and 3-digit hex", () => {
    expect(findInvalidTenantColor({ primaryColor: "#1a4fff" })).toBeNull();
    expect(findInvalidTenantColor({ accentColor: "#18B6A8" })).toBeNull();
    expect(findInvalidTenantColor({ bgColor: "#fff" })).toBeNull();
  });

  it("rejects the CSS-injection payload the validator exists for", () => {
    expect(
      findInvalidTenantColor({ primaryColor: "red} body{display:none}" })
    ).toBe("primaryColor");
  });

  it("rejects named colours and functional notation", () => {
    expect(findInvalidTenantColor({ textColor: "red" })).toBe("textColor");
    expect(findInvalidTenantColor({ bgColor: "rgb(0,0,0)" })).toBe("bgColor");
    expect(findInvalidTenantColor({ accentColor: "#12345" })).toBe("accentColor");
  });

  it("rejects a non-string value", () => {
    expect(findInvalidTenantColor({ primaryColor: 123 })).toBe("primaryColor");
  });

  it("allows absent or empty values so callers can fall back to a default", () => {
    expect(findInvalidTenantColor({})).toBeNull();
    expect(findInvalidTenantColor({ primaryColor: "" })).toBeNull();
    expect(findInvalidTenantColor({ primaryColor: undefined })).toBeNull();
    expect(findInvalidTenantColor({ primaryColor: null })).toBeNull();
  });

  it("names the first offending field when several are provided", () => {
    const bad = findInvalidTenantColor({
      primaryColor: "#1a4fff",
      accentColor: "nope",
      textColor: "also-nope",
    });
    expect(bad).toBe("accentColor");
  });

  it("checks every branding colour field, not just the primary", () => {
    for (const field of ["primaryColor", "accentColor", "secondaryColor", "bgColor", "textColor"]) {
      expect(findInvalidTenantColor({ [field]: "}{" })).toBe(field);
    }
  });
});
