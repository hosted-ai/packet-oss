import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getLoginLog } from "@/lib/auth/login-log";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const pageParam = url.searchParams.get("page");
  const limitParam = url.searchParams.get("limit");
  const email = url.searchParams.get("email") || undefined;
  const successParam = url.searchParams.get("success");

  const page = pageParam ? Math.max(1, parseInt(pageParam)) : 1;
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam)), 200) : 50;
  const success = successParam !== null ? successParam === "true" : undefined;

  try {
    const result = await getLoginLog({ page, limit, email, success });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch login log:", error);
    return NextResponse.json(
      { error: "Failed to fetch login log" },
      { status: 500 }
    );
  }
}
