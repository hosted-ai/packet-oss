// Guards the generated spec itself (PA-261, Part A): the committed
// tests/contract/openapi.yaml must be byte-for-byte what generate-openapi.ts
// produces from the current registry, and the registry must cover the
// ticket's acceptance criterion of at least 30 internal endpoints.
//
// Run `pnpm run generate:openapi` and commit the result if this fails.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parse as parseYAML, stringify } from "yaml";
import { join } from "path";
import { buildOpenApiDocument } from "./generate-openapi";
import { contractEndpoints } from "./registry";

describe("tests/contract/openapi.yaml", () => {
  it("matches the spec generated from the current registry", () => {
    const committed = readFileSync(join(__dirname, "openapi.yaml"), "utf8");
    const generated = stringify(buildOpenApiDocument(), { sortMapEntries: false });
    expect(parseYAML(committed)).toEqual(parseYAML(generated));
  });

  it("covers at least 30 internal endpoints", () => {
    expect(contractEndpoints.length).toBeGreaterThanOrEqual(30);
  });

  it("has no duplicate method+path entries", () => {
    const keys = contractEndpoints.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
