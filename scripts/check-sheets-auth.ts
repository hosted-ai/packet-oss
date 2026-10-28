#!/usr/bin/env npx tsx
/**
 * Diagnostic: confirm which Google account our OAuth token belongs to,
 * which spreadsheet we're talking to, and what tabs already exist.
 *
 * Usage:
 *   npx tsx scripts/check-sheets-auth.ts --sheet-id <id>
 *   npx tsx scripts/check-sheets-auth.ts --sheet-url <url>
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getSheetsClient, parseSheetId } from "./lib/sheets-client";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const args = process.argv.slice(2);
function arg(n: string): string | undefined {
  const i = args.findIndex((a) => a === `--${n}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const sheetArg = arg("sheet-id") ?? arg("sheet-url");

async function main() {
  console.log("[diag] loading credentials...");
  const sheets = await getSheetsClient();

  // (We can't call userinfo — our OAuth scope is spreadsheets-only.
  //  Instead, we'll detect account mismatch by listing the user's sheets
  //  via the Drive API, but that needs Drive scope too. So we just
  //  try to access the target sheet directly below.)

  if (!sheetArg) {
    console.log("");
    console.log("Pass --sheet-id or --sheet-url to inspect a specific sheet.");
    return;
  }

  const sheetId = parseSheetId(sheetArg);
  console.log("");
  console.log(`[diag] parsed sheet ID: ${sheetId}`);
  console.log(`[diag] URL the report scripts will use:`);
  console.log(`       https://docs.google.com/spreadsheets/d/${sheetId}/edit`);

  // 2. Does this account see that sheet?
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "properties.title,sheets.properties(title,sheetId,index)",
    });
    console.log("");
    console.log(`[diag] sheet title: "${meta.data.properties?.title}"`);
    console.log(`[diag] tabs (${meta.data.sheets?.length}):`);
    for (const s of meta.data.sheets ?? []) {
      console.log(`         [${s.properties?.index}] ${s.properties?.title}   (sheetId=${s.properties?.sheetId})`);
    }
  } catch (err) {
    console.error("");
    console.error(`[diag] FAILED to read sheet ${sheetId}:`);
    console.error(`       ${(err as Error).message}`);
    console.error("");
    console.error("Most likely:");
    console.error("  - Wrong sheet ID/URL");
    console.error("  - The Google account above doesn't have access to this sheet");
    console.error("    (share the sheet with that account, or sign out and re-auth)");
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
