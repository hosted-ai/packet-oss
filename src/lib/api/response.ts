// API Response Helpers

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { ApiError } from "./errors";
import type { ApiMeta, ApiResponse, ApiErrorResponse, PaginatedResponse, RateLimitInfo } from "./types";

function createMeta(): ApiMeta {
  return {
    requestId: `req_${nanoid(12)}`,
    timestamp: new Date().toISOString(),
  };
}

export function success<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      data,
      meta: createMeta(),
    },
    { status }
  );
}

export function created<T>(data: T): NextResponse<ApiResponse<T>> {
  return success(data, 201);
}

export function paginated<T>(
  data: T[],
  pagination: { page: number; perPage: number; total: number }
): NextResponse<PaginatedResponse<T>> {
  return NextResponse.json({
    data,
    meta: createMeta(),
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.perPage),
    },
  });
}

export function error(err: ApiError | Error): NextResponse<ApiErrorResponse> {
  if (err instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details && { details: err.details }),
        },
        meta: createMeta(),
      },
      { status: err.status }
    );
  }

  // Unknown error - log it and return generic message
  console.error("Unhandled API error:", err);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
      },
      meta: createMeta(),
    },
    { status: 500 }
  );
}

export function withRateLimitHeaders(
  response: NextResponse,
  rateLimit: RateLimitInfo
): NextResponse {
  response.headers.set("X-RateLimit-Limit", rateLimit.limit.toString());
  response.headers.set("X-RateLimit-Remaining", rateLimit.remaining.toString());
  response.headers.set("X-RateLimit-Reset", rateLimit.reset.toString());
  return response;
}

// Helper to parse pagination params from URL
export function parsePagination(url: URL): { page: number; perPage: number } {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "20", 10)));
  return { page, perPage };
}
