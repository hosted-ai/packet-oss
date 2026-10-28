/**
 * Google Sheets writer using the "installed app" OAuth flow.
 *
 * Why this flow: organizations often block service account creation. This
 * flow uses a personal/SSO Google account. First run opens the browser for
 * consent, the refresh token is cached to disk, subsequent runs are silent.
 *
 * Setup (one-time, done in Google Cloud Console):
 *   1. Enable Google Sheets API: console.cloud.google.com/apis/library/sheets.googleapis.com
 *   2. APIs & Services → Credentials → Create Credentials → OAuth client ID
 *        Application type: "Desktop app"
 *        Name: whatever (e.g. "packet-reports")
 *      Download the JSON.
 *   3. (If your project is "External" and unverified) Add yourself as a Test User:
 *        APIs & Services → OAuth consent screen → Test users → Add users
 *   4. Save the JSON path to .env.local:
 *        GOOGLE_OAUTH_CLIENT_PATH=/Users/you/.config/packet-google-client.json
 *
 * After that, just pass --sheet-id (or --sheet-url) to the report scripts.
 * First run pops a browser for consent. Token cached at
 *   ~/.config/packet-google-token.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { createServer } from "http";
import { exec } from "child_process";
import { google, sheets_v4, Auth } from "googleapis";

const TOKEN_PATH = resolve(homedir(), ".config", "packet-google-token.json");
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

type ClientSecrets = {
  installed?: { client_id: string; client_secret: string; redirect_uris?: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris?: string[] };
};

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"` :
    process.platform === "win32"  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd, () => { /* don't care about result, user can copy URL anyway */ });
}

function loadClientSecrets(): { clientId: string; clientSecret: string } {
  const path = process.env.GOOGLE_OAUTH_CLIENT_PATH;
  if (!path) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_PATH not set. Download an OAuth client JSON " +
      "from Google Cloud Console (type 'Desktop app') and point this env to it. " +
      "See scripts/lib/sheets-client.ts header for full setup steps.",
    );
  }
  if (!existsSync(path)) {
    throw new Error(`GOOGLE_OAUTH_CLIENT_PATH file not found: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as ClientSecrets;
  const cfg = raw.installed ?? raw.web;
  if (!cfg) throw new Error(`Unexpected client secret format at ${path}`);
  return { clientId: cfg.client_id, clientSecret: cfg.client_secret };
}

async function interactiveAuth(client: Auth.OAuth2Client): Promise<Auth.Credentials> {
  // Spin up a local server on a random port to catch the OAuth redirect.
  return new Promise((resolveAuth, rejectAuth) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost`);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.end(`Google returned an error: ${error}. You can close this tab.`);
          server.close();
          rejectAuth(new Error(error));
          return;
        }
        if (!code) {
          res.end("Waiting for Google to return a code...");
          return;
        }
        const { tokens } = await client.getToken(code);
        res.end("Auth successful. You can close this tab and return to your terminal.");
        server.close();
        resolveAuth(tokens);
      } catch (e) {
        rejectAuth(e as Error);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        rejectAuth(new Error("Could not bind local OAuth callback server"));
        return;
      }
      const redirectUri = `http://127.0.0.1:${addr.port}`;
      client.redirectUri = redirectUri;
      const authUrl = client.generateAuthUrl({
        access_type: "offline",   // get refresh token
        prompt: "consent",        // always show consent so refresh token is issued
        scope: SCOPES,
      });
      console.log("");
      console.log("[google-sheets] One-time auth needed. Opening your browser...");
      console.log(`[google-sheets] If it doesn't open, visit this URL manually:`);
      console.log(`  ${authUrl}`);
      console.log("");
      openBrowser(authUrl);
    });

    server.on("error", rejectAuth);
  });
}

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const { clientId, clientSecret } = loadClientSecrets();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);

  if (existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8")) as Auth.Credentials;
    oauth2.setCredentials(tokens);
    // Refresh the access token if needed (refresh_token is durable, access expires hourly)
    try {
      await oauth2.getAccessToken();
    } catch {
      console.log("[google-sheets] cached token rejected, re-authing...");
      const fresh = await interactiveAuth(oauth2);
      oauth2.setCredentials(fresh);
      mkdirSync(dirname(TOKEN_PATH), { recursive: true });
      writeFileSync(TOKEN_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
    }
  } else {
    const fresh = await interactiveAuth(oauth2);
    oauth2.setCredentials(fresh);
    mkdirSync(dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
    console.log(`[google-sheets] token saved to ${TOKEN_PATH}`);
  }

  return google.sheets({ version: "v4", auth: oauth2 });
}

/**
 * Extract a spreadsheet ID from either a sheet URL or a raw ID.
 *   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0  →  <ID>
 *   <ID>                                                   →  <ID>
 */
export function parseSheetId(input: string): string {
  const m = input.match(/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : input;
}

// ── Color palette ─────────────────────────────────────────────────────
const COLOR = {
  headerBg: { red: 0.118, green: 0.227, blue: 0.541 },   // #1E3A8A indigo
  headerFg: { red: 1, green: 1, blue: 1 },               // white
  titleBg:  { red: 0.929, green: 0.949, blue: 0.996 },   // #EDF1FE very light blue
  titleFg:  { red: 0.118, green: 0.227, blue: 0.541 },   // #1E3A8A indigo (matches header)
  bandFirst: { red: 1, green: 1, blue: 1 },              // white
  bandSecond: { red: 0.961, green: 0.969, blue: 0.984 }, // #F5F7FB very light gray
  statusActiveBg:  { red: 0.820, green: 0.937, blue: 0.847 }, // #D1F0D8 light green
  statusActiveFg:  { red: 0.024, green: 0.341, blue: 0.196 }, // #065732 dark green
  statusChurnedBg: { red: 0.996, green: 0.886, blue: 0.886 }, // #FEE2E2 light red
  statusChurnedFg: { red: 0.600, green: 0.102, blue: 0.102 }, // #991B1B dark red
  statusWarmBg:    { red: 0.996, green: 0.953, blue: 0.780 }, // #FEF3C7 light yellow
  statusWarmFg:    { red: 0.572, green: 0.259, blue: 0.055 }, // #92400E dark amber
};

/**
 * Ensure a tab exists, then overwrite its contents with the given rows.
 * Rows is the full grid including the header row.
 *
 * Layout:
 *   - Optional description block at top (title bold + larger, then body in light blue background)
 *   - Blank separator
 *   - Header row (dark indigo bg, white bold text)
 *   - Data rows (banded, alternating white/light-gray)
 *
 * Extras:
 *   - Top description rows + header row are frozen.
 *   - First column is also frozen (handy for long horizontal scrolls).
 *   - Any column whose header ends in "_USD" is formatted as currency.
 *   - A "Status" column gets conditional colors (Active / Churned / Paid but never launched).
 *   - Columns are auto-resized to fit content.
 */
export async function writeTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  rows: Array<Array<string | number>>,
  description?: string,
): Promise<{ tabSheetId: number; headerRowIndex: number; dataStartRow: number; dataEndRow: number }> {
  // 1. Look up tab + existing bandings/conditional rules (to clear them)
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties,bandedRanges,conditionalFormats)",
  });
  let sheetTab = (meta.data.sheets ?? []).find((s) => s.properties?.title === tabName);
  if (!sheetTab) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    const newId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
    sheetTab = { properties: { sheetId: newId, title: tabName } };
  }
  const tabSheetId = sheetTab.properties?.sheetId!;

  // 2. Clear values + reset stale formatting from previous runs
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName });

  const resetRequests: sheets_v4.Schema$Request[] = [];
  for (const b of sheetTab.bandedRanges ?? []) {
    if (b.bandedRangeId !== undefined) resetRequests.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
  }
  const condCount = sheetTab.conditionalFormats?.length ?? 0;
  // Delete in reverse-order so indices stay valid
  for (let i = condCount - 1; i >= 0; i--) {
    resetRequests.push({ deleteConditionalFormatRule: { sheetId: tabSheetId, index: i } });
  }
  // Wipe userEnteredFormat across the whole grid before we set new formats
  resetRequests.push({
    repeatCell: {
      range: { sheetId: tabSheetId },
      cell: { userEnteredFormat: {} },
      fields: "userEnteredFormat",
    },
  });
  if (resetRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: resetRequests } });
  }

  if (rows.length === 0) {
    return { tabSheetId, headerRowIndex: 0, dataStartRow: 0, dataEndRow: 0 };
  }

  // 3. Build the grid: optional description lines + blank separator + data
  const descLines = description
    ? description.split("\n").map((line) => [line])
    : [];
  const grid: Array<Array<string | number>> = [];
  if (descLines.length) {
    grid.push(...descLines);
    grid.push([""]);  // blank separator row
  }
  grid.push(...rows);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: grid },
  });

  // 4. Layout maths
  const descBodyRows = descLines.length;
  const descRowCount = descBodyRows ? descBodyRows + 1 : 0;  // +1 for blank
  const headerRowIndex = descRowCount;                       // 0-based
  const dataStartRow = headerRowIndex + 1;
  const dataEndRow = dataStartRow + (rows.length - 1);       // inclusive-exclusive: + rows.length - 1
  const headerCols = rows[0] as Array<string>;
  const colCount = headerCols.length;
  const frozenRowCount = headerRowIndex + 1;                 // description + blank + headers

  const styleRequests: sheets_v4.Schema$Request[] = [];

  // 4a. Freeze top rows + first column
  styleRequests.push({
    updateSheetProperties: {
      properties: {
        sheetId: tabSheetId,
        gridProperties: { frozenRowCount, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 4b. Description block formatting (title row bold/colored, body lighter, all on tinted bg)
  if (descBodyRows > 0) {
    // Title row (first description line): larger + bold + indigo
    styleRequests.push({
      repeatCell: {
        range: {
          sheetId: tabSheetId,
          startRowIndex: 0, endRowIndex: 1,
          startColumnIndex: 0, endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLOR.titleBg,
            textFormat: { bold: true, fontSize: 13, foregroundColor: COLOR.titleFg },
            padding: { top: 6, bottom: 6, left: 8, right: 8 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,padding)",
      },
    });
    // Body rows (subsequent description lines): same tinted bg, regular weight
    if (descBodyRows > 1) {
      styleRequests.push({
        repeatCell: {
          range: {
            sheetId: tabSheetId,
            startRowIndex: 1, endRowIndex: descBodyRows,
            startColumnIndex: 0, endColumnIndex: colCount,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: COLOR.titleBg,
              textFormat: { foregroundColor: COLOR.titleFg, italic: true },
              padding: { top: 2, bottom: 2, left: 8, right: 8 },
              wrapStrategy: "WRAP",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,padding,wrapStrategy)",
        },
      });
    }
  }

  // 4c. Header row: dark indigo bg, white bold text, slight padding
  styleRequests.push({
    repeatCell: {
      range: {
        sheetId: tabSheetId,
        startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1,
        startColumnIndex: 0, endColumnIndex: colCount,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOR.headerBg,
          textFormat: { bold: true, foregroundColor: COLOR.headerFg, fontSize: 10 },
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          padding: { top: 6, bottom: 6, left: 8, right: 8 },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
    },
  });

  // 4d. Banded rows over the data (excluding header)
  if (rows.length > 1) {
    styleRequests.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId: tabSheetId,
            startRowIndex: dataStartRow,
            endRowIndex: dataEndRow + 1,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          rowProperties: {
            firstBandColor: COLOR.bandFirst,
            secondBandColor: COLOR.bandSecond,
          },
        },
      },
    });
  }

  // 4e. Currency format on any column whose header ends in "_USD"
  for (let c = 0; c < colCount; c++) {
    if (typeof headerCols[c] === "string" && headerCols[c].endsWith("_USD")) {
      styleRequests.push({
        repeatCell: {
          range: {
            sheetId: tabSheetId,
            startRowIndex: dataStartRow, endRowIndex: dataEndRow + 1,
            startColumnIndex: c, endColumnIndex: c + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
              horizontalAlignment: "RIGHT",
            },
          },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
    }
  }

  // 4f. Conditional formatting for "Status" column, if present
  const statusCol = headerCols.findIndex((h) => h === "Status");
  if (statusCol >= 0) {
    const statusRange = {
      sheetId: tabSheetId,
      startRowIndex: dataStartRow, endRowIndex: dataEndRow + 1,
      startColumnIndex: statusCol, endColumnIndex: statusCol + 1,
    };
    const condFormat = (text: string, bg: typeof COLOR.statusActiveBg, fg: typeof COLOR.statusActiveFg) => ({
      addConditionalFormatRule: {
        rule: {
          ranges: [statusRange],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: text }] },
            format: { backgroundColor: bg, textFormat: { foregroundColor: fg, bold: true } },
          },
        },
      },
    });
    styleRequests.push(condFormat("Active", COLOR.statusActiveBg, COLOR.statusActiveFg) as sheets_v4.Schema$Request);
    styleRequests.push(condFormat("Churned", COLOR.statusChurnedBg, COLOR.statusChurnedFg) as sheets_v4.Schema$Request);
    styleRequests.push(condFormat("Paid but never launched", COLOR.statusWarmBg, COLOR.statusWarmFg) as sheets_v4.Schema$Request);
  }

  // 4g. Auto-resize all columns to fit content
  styleRequests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId: tabSheetId,
        dimension: "COLUMNS",
        startIndex: 0, endIndex: colCount,
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: styleRequests } });
  return { tabSheetId, headerRowIndex, dataStartRow, dataEndRow };
}

/**
 * Write a styled README tab: leading "# " = title row (large bold on indigo bg),
 * "## " = section heading (medium bold on light-blue bg), everything else =
 * regular body text. Strips the leading "# " / "## " markers from the visible
 * cell so the user sees clean text.
 */
export async function writeReadmeTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  lines: string[],
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties,bandedRanges,conditionalFormats)",
  });
  let sheetTab = (meta.data.sheets ?? []).find((s) => s.properties?.title === tabName);
  if (!sheetTab) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: { properties: { title: tabName, index: 0 } },   // first tab
        }],
      },
    });
    const newId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
    sheetTab = { properties: { sheetId: newId, title: tabName } };
  }
  const tabSheetId = sheetTab.properties?.sheetId!;

  // Reset prior formatting on this tab
  const resetRequests: sheets_v4.Schema$Request[] = [];
  for (const b of sheetTab.bandedRanges ?? []) {
    if (b.bandedRangeId !== undefined) resetRequests.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
  }
  const condCount = sheetTab.conditionalFormats?.length ?? 0;
  for (let i = condCount - 1; i >= 0; i--) {
    resetRequests.push({ deleteConditionalFormatRule: { sheetId: tabSheetId, index: i } });
  }
  resetRequests.push({
    repeatCell: {
      range: { sheetId: tabSheetId },
      cell: { userEnteredFormat: {} },
      fields: "userEnteredFormat",
    },
  });
  if (resetRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: resetRequests } });
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName });

  // Strip the markdown markers from displayed text so the cells look clean
  const displayLines = lines.map((l) => {
    if (l.startsWith("## ")) return l.slice(3);
    if (l.startsWith("# "))  return l.slice(2);
    return l;
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: displayLines.map((l) => [l]) },
  });

  const requests: sheets_v4.Schema$Request[] = [];

  // Default body styling for every row (so unknown lines look consistent)
  requests.push({
    repeatCell: {
      range: {
        sheetId: tabSheetId,
        startRowIndex: 0, endRowIndex: lines.length,
        startColumnIndex: 0, endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          padding: { top: 3, bottom: 3, left: 12, right: 12 },
          wrapStrategy: "WRAP",
          verticalAlignment: "MIDDLE",
          textFormat: { fontSize: 10 },
        },
      },
      fields: "userEnteredFormat(padding,wrapStrategy,verticalAlignment,textFormat)",
    },
  });

  // Style each tagged row
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      // Title — large bold white on dark indigo
      requests.push({
        repeatCell: {
          range: {
            sheetId: tabSheetId,
            startRowIndex: i, endRowIndex: i + 1,
            startColumnIndex: 0, endColumnIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: COLOR.headerBg,
              padding: { top: 12, bottom: 12, left: 16, right: 16 },
              textFormat: { bold: true, fontSize: 18, foregroundColor: COLOR.headerFg },
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,padding,textFormat,verticalAlignment)",
        },
      });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: tabSheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: 48 },
          fields: "pixelSize",
        },
      });
    } else if (line.startsWith("## ")) {
      // Section heading — medium bold indigo on tinted bg
      requests.push({
        repeatCell: {
          range: {
            sheetId: tabSheetId,
            startRowIndex: i, endRowIndex: i + 1,
            startColumnIndex: 0, endColumnIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: COLOR.titleBg,
              padding: { top: 8, bottom: 8, left: 12, right: 12 },
              textFormat: { bold: true, fontSize: 12, foregroundColor: COLOR.titleFg },
              verticalAlignment: "MIDDLE",
              borders: {
                bottom: { style: "SOLID", color: COLOR.titleFg },
              },
            },
          },
          fields: "userEnteredFormat(backgroundColor,padding,textFormat,verticalAlignment,borders)",
        },
      });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: tabSheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: 34 },
          fields: "pixelSize",
        },
      });
    }
  }

  // Widen column A and hide everything beyond it
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: tabSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 980 },
      fields: "pixelSize",
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Embed a chart on a tab. Assumes the data is laid out as:
 *   - dataStartRow/dataEndRow rows (inclusive-exclusive) of values
 *   - column 0 = X-axis (domain), columns 1..N = series
 *   - one header row immediately above dataStartRow (used as series labels)
 *
 * Anchored below the data block. Stale charts on the tab are deleted first.
 */
export async function addChart(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetId: number,
  opts: {
    title: string;
    chartType: "LINE" | "COLUMN" | "STACKED_COLUMN" | "STACKED_AREA";
    headerRow: number;       // 0-based row containing column headers / series labels
    dataStartRow: number;    // 0-based row index of first data row
    dataEndRow: number;      // 0-based row index of last data row (inclusive)
    domainColumnIndex: number;     // typically 0 (the Month column)
    seriesColumnIndices: number[]; // columns that should each become a chart series
    anchorRow: number;       // where to place the chart top-left
    anchorCol: number;
  },
): Promise<void> {
  // Delete any existing charts on this tab first
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties,charts)",
  });
  const target = (meta.data.sheets ?? []).find((s) => s.properties?.sheetId === tabSheetId);
  const stale = target?.charts ?? [];
  const requests: sheets_v4.Schema$Request[] = [];
  for (const c of stale) {
    if (c.chartId !== undefined) requests.push({ deleteEmbeddedObject: { objectId: c.chartId } });
  }

  // ChartData wraps a ChartSourceRange. Don't skip the sourceRange layer.
  const domain = {
    sourceRange: {
      sources: [{
        sheetId: tabSheetId,
        startRowIndex: opts.headerRow,
        endRowIndex: opts.dataEndRow + 1,
        startColumnIndex: opts.domainColumnIndex,
        endColumnIndex: opts.domainColumnIndex + 1,
      }],
    },
  };
  const series = opts.seriesColumnIndices.map((c) => ({
    series: {
      sourceRange: {
        sources: [{
          sheetId: tabSheetId,
          startRowIndex: opts.headerRow,
          endRowIndex: opts.dataEndRow + 1,
          startColumnIndex: c,
          endColumnIndex: c + 1,
        }],
      },
    },
    targetAxis: "LEFT_AXIS",
  }));

  requests.push({
    addChart: {
      chart: {
        spec: {
          title: opts.title,
          basicChart: {
            chartType: opts.chartType === "STACKED_COLUMN" ? "COLUMN" :
                       opts.chartType === "STACKED_AREA"   ? "AREA"   : opts.chartType,
            stackedType: opts.chartType === "STACKED_COLUMN" || opts.chartType === "STACKED_AREA"
              ? "STACKED" : undefined,
            legendPosition: "BOTTOM_LEGEND",
            headerCount: 1,
            // Note: axis.format is for text styling only. To get currency on the
            // y-axis, format the underlying cells (we do that for _USD columns).
            axis: [
              { position: "BOTTOM_AXIS", title: "Month" },
              { position: "LEFT_AXIS",   title: "USD"   },
            ],
            domains: [{ domain }],
            series,
          },
          titleTextFormat: { bold: true, fontSize: 14 },
          backgroundColor: { red: 1, green: 1, blue: 1 },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: tabSheetId, rowIndex: opts.anchorRow, columnIndex: opts.anchorCol },
            widthPixels: 900,
            heightPixels: 360,
          },
        },
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Convert array-of-objects rows into the 2D array Sheets expects.
 * Uses the first row's keys as the column order (consistent with our CSV).
 */
export function rowsToGrid(rows: Array<Record<string, unknown>>): Array<Array<string | number>> {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const grid: Array<Array<string | number>> = [headers];
  for (const r of rows) {
    grid.push(
      headers.map((h) => {
        const v = r[h];
        if (v === null || v === undefined) return "";
        if (typeof v === "number") return v;
        if (v instanceof Date) return v.toISOString();
        return String(v);
      }),
    );
  }
  return grid;
}
