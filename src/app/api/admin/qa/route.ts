import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import fs from "fs";
import path from "path";

const QA_STATE_FILE = path.join(process.cwd(), "data", "qa-state.json");

function ensureDataDir() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadQAState() {
  try {
    if (fs.existsSync(QA_STATE_FILE)) {
      const data = fs.readFileSync(QA_STATE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load QA state:", error);
  }
  return { results: {}, lastUpdated: "" };
}

function saveQAState(state: unknown) {
  ensureDataDir();
  fs.writeFileSync(QA_STATE_FILE, JSON.stringify(state, null, 2));
}

// GET - Load QA state
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const state = loadQAState();
  return NextResponse.json(state);
}

// POST - Save QA state (with merge to prevent race conditions)
export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const incomingState = await request.json();

    // Load current state and merge to prevent race conditions
    const currentState = loadQAState();

    // Merge results - incoming changes take precedence for their specific test IDs
    // but we preserve other test results that may have been added by other users
    const mergedResults = {
      ...currentState.results,
      ...incomingState.results,
    };

    const mergedState = {
      results: mergedResults,
      lastUpdated: incomingState.lastUpdated || new Date().toISOString(),
    };

    saveQAState(mergedState);
    return NextResponse.json({ success: true, state: mergedState });
  } catch (error) {
    console.error("Failed to save QA state:", error);
    return NextResponse.json(
      { error: "Failed to save" },
      { status: 500 }
    );
  }
}
