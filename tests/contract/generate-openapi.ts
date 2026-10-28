// Builds the OpenAPI 3.1 document for the contract-tested endpoint subset
// (PA-261, Part A) from `registry.ts`, using zod v4's built-in
// `z.toJSONSchema()` — OpenAPI 3.1 speaks JSON Schema 2020-12 natively, so no
// extra `zod-to-openapi` dependency is needed on top of the `zod` already in
// this repo.
//
// Run directly to (re)write the committed `openapi.yaml`:
//   pnpm run generate:openapi

import { z } from "zod";
import { contractEndpoints } from "./registry";

function schemaName(method: string, path: string): string {
  const parts = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return `${method.charAt(0)}${method.slice(1).toLowerCase()}${parts.join("")}Response`;
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, unknown> = {};

  for (const ep of contractEndpoints) {
    const name = schemaName(ep.method, ep.path);
    const jsonSchema = z.toJSONSchema(ep.response) as Record<string, unknown>;
    delete jsonSchema.$schema;
    schemas[name] = jsonSchema;

    paths[ep.path] ??= {};
    const openapiPath = ep.path.replace(/\{(\w+)\}/g, "{$1}");
    paths[ep.path][ep.method.toLowerCase()] = {
      summary: ep.summary,
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
          },
        },
      },
      ...(openapiPath.includes("{")
        ? {
            parameters: Array.from(openapiPath.matchAll(/\{(\w+)\}/g)).map((m) => ({
              name: m[1],
              in: "path",
              required: true,
              schema: { type: "string" },
            })),
          }
        : {}),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Packet.ai internal API (contract-tested subset)",
      version: "1.0.0",
      description:
        "A generated, partial OpenAPI spec covering the internal endpoints under contract " +
        "test in tests/contract/. NOT a full API reference — see registry.ts for scope. " +
        "Regenerate via `pnpm run generate:openapi`; CI blocks unreviewed changes to this file " +
        "(see .bitbucket/check-openapi-breaking-change.sh).",
    },
    paths,
    components: { schemas },
  };
}

async function main() {
  const { stringify } = await import("yaml");
  const { writeFileSync } = await import("fs");
  const { fileURLToPath } = await import("url");
  const path = await import("path");
  const doc = buildOpenApiDocument();
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "openapi.yaml");
  writeFileSync(out, stringify(doc, { sortMapEntries: false }));
  console.log(`Wrote ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
