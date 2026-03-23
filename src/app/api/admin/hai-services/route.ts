/**
 * Admin proxy for HAI services listing
 * GET /api/admin/hai-services?search=&page=0&per_page=20
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { hostedaiRequest } from "@/lib/hostedai";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = verifySessionToken(sessionToken);
  if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  try {
    const search = request.nextUrl.searchParams.get("search") || "";
    const page = request.nextUrl.searchParams.get("page") || "0";
    const perPage = request.nextUrl.searchParams.get("per_page") || "20";

    // Build query for HAI service listing API
    const params = new URLSearchParams({
      page,
      per_page: perPage,
      itemsPerPage: perPage,
      sort: "name",
      order: "asc",
    });
    if (search) {
      params.set("name[peqstr]", search);
    }

    const data = await hostedaiRequest<{
      items?: Array<{
        id: string;
        name: string;
        description: string;
        service_type: string;
        is_enabled: boolean;
        is_system_defined: boolean;
        recipe_id: number | null;
        recipe_exec_timing_type: string | null;
        instances_count: number;
      }>;
      total?: number;
      page?: number;
      per_page?: number;
    }>("GET", `/service?${params.toString()}`);

    // Normalize response -- HAI may return items array or flat array
    const items = data.items || (Array.isArray(data) ? data : []);

    return NextResponse.json({
      services: items.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        serviceType: s.service_type,
        isEnabled: s.is_enabled,
        isSystemDefined: s.is_system_defined,
        recipeId: s.recipe_id,
        recipeExecTimingType: s.recipe_exec_timing_type,
        instancesCount: s.instances_count,
      })),
      total: data.total || items.length,
    });
  } catch (error) {
    console.error("[Admin] Failed to fetch HAI services:", error);
    return NextResponse.json(
      { error: "Failed to fetch services from HAI" },
      { status: 500 }
    );
  }
}
