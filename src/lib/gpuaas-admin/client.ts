/**
 * GPUaaS Admin API Client
 *
 * Cookie-based authentication client for the GPUaaS admin API.
 * This client manages session cookies internally and re-authenticates as needed.
 *
 * @module gpuaas-admin/client
 */

import type { LoginResponse, APIError } from "./types";

const GPUAAS_ADMIN_URL =
  process.env.GPUAAS_ADMIN_URL || "http://localhost:3001";
const GPUAAS_ADMIN_USER = process.env.GPUAAS_ADMIN_USER!;
const GPUAAS_ADMIN_PASSWORD = process.env.GPUAAS_ADMIN_PASSWORD!;

// Session management
let sessionCookie: string | null = null;
let sessionExpiry: number | null = null;
const SESSION_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

/**
 * Login to get session cookie
 */
async function login(): Promise<string> {
  console.log(`[GPUaaS Admin] Logging in as ${GPUAAS_ADMIN_USER}`);

  const response = await fetch(`${GPUAAS_ADMIN_URL}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: GPUAAS_ADMIN_USER,
      password: GPUAAS_ADMIN_PASSWORD,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GPUaaS Admin login failed (${response.status}): ${text}`);
  }

  const data: LoginResponse = await response.json();

  // Extract cookie from Set-Cookie header or use token
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    // Parse the cookie - typically "session=value; Path=...; HttpOnly"
    const match = setCookie.match(/^([^;]+)/);
    if (match) {
      sessionCookie = match[1];
    }
  }

  // If no cookie in header, use token in Cookie header
  if (!sessionCookie && data.token) {
    sessionCookie = `token=${data.token}`;
  }

  // Set expiry (default 1 hour if not specified)
  sessionExpiry = Date.now() + 60 * 60 * 1000;

  console.log(`[GPUaaS Admin] Login successful, session established`);
  return sessionCookie!;
}

/**
 * Ensure we have a valid session
 */
async function ensureSession(): Promise<string> {
  // Check if we need to refresh
  const needsRefresh =
    !sessionCookie ||
    !sessionExpiry ||
    Date.now() > sessionExpiry - SESSION_BUFFER_MS;

  if (needsRefresh) {
    return await login();
  }

  return sessionCookie!;
}

/**
 * Make an authenticated request to the GPUaaS Admin API
 */
export async function gpuaasAdminRequest<T>(
  method: string,
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const cookie = await ensureSession();
  const url = `${GPUAAS_ADMIN_URL}/api${endpoint}`;

  console.log(`[GPUaaS Admin] ${method} ${url}`);
  if (data) {
    console.log(`[GPUaaS Admin] Request body:`, JSON.stringify(data, null, 2));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`[GPUaaS Admin] API error ${response.status}:`, text);

    // Check if it's an auth error - re-login and retry once
    if (response.status === 401) {
      console.log(`[GPUaaS Admin] Session expired, re-authenticating...`);
      sessionCookie = null;
      sessionExpiry = null;

      const newCookie = await login();
      const retryResponse = await fetch(url, {
        method,
        headers: {
          Cookie: newCookie,
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      const retryText = await retryResponse.text();
      if (!retryResponse.ok) {
        throw new Error(
          `GPUaaS Admin API error (${retryResponse.status}): ${retryText}`
        );
      }

      return retryText ? JSON.parse(retryText) : ({} as T);
    }

    // Parse error response
    let errorMessage = text;
    try {
      const errorData: APIError = JSON.parse(text);
      errorMessage = errorData.message || text;
      if (errorData.errors?.length) {
        const fieldErrors = errorData.errors
          .map((e) => `${e.field}: ${e.message}`)
          .join(", ");
        errorMessage = `${errorMessage} (${fieldErrors})`;
      }
    } catch {
      // Text is not JSON
    }

    throw new Error(`GPUaaS Admin API error (${response.status}): ${errorMessage}`);
  }

  if (!text) {
    console.log(`[GPUaaS Admin] Empty response for: ${endpoint}`);
    return {} as T;
  }

  try {
    const parsed = JSON.parse(text);
    console.log(`[GPUaaS Admin] Response:`, JSON.stringify(parsed, null, 2));
    return parsed;
  } catch {
    console.log(`[GPUaaS Admin] Non-JSON response:`, text);
    return { success: true } as T;
  }
}

/**
 * Clear the session (force re-login on next request)
 */
export function clearSession(): void {
  sessionCookie = null;
  sessionExpiry = null;
}

/**
 * Get the API base URL
 */
export function getApiUrl(): string {
  return GPUAAS_ADMIN_URL;
}
