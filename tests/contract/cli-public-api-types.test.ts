// The CLI's request and response types are generated from packet-api's public spec,
// pinned at cli/openapi/public.json (packet-api internal/openapi/generated/public.json at 30a337b0).
// Re-pin the spec, then run `pnpm generate:cli-types`.

import { execFileSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

describe("CLI public API types", () => {
  it("match the pinned public spec", () => {
    expect(() =>
      execFileSync(
        path.join(root, "node_modules/.bin/openapi-typescript"),
        ["cli/openapi/public.json", "-o", "cli/src/generated/public-api.ts", "--check"],
        { cwd: root, stdio: "pipe" }
      )
    ).not.toThrow();
  });
});
