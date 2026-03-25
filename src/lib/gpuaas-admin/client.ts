/**
 * HAI Admin Panel API Client
 *
 * Cookie-based authentication client for the HAI admin API (formerly "GPUaaS admin").
 * This client manages session cookies internally and re-authenticates as needed.
 *
 * Credentials are resolved via getSetting() which checks:
 *   1. DB (SystemSetting table — set via Platform Settings UI)
 *   2. process.env HOSTEDAI_ADMIN_* (canonical)
 *   3. process.env GPUAAS_ADMIN_* (legacy alias for existing installs)
 *
 * @module gpuaas-admin/client
 */

import { getSetting } from "@/lib/settings";
import type { LoginResponse, APIError } from "./types";

// Session management
let sessionCookie: string | null = null;
let sessionExpiry: number | null = null;
const SESSION_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

/**
 * Resolve HAI admin credentials from DB → env → legacy env.
 */
export async function getAdminCredentials(): Promise<{
  url: string;
  username: string;
  password: string;
}> {
  const url = await getSetting("HOSTEDAI_ADMIN_URL");
  const username = await getSetting("HOSTEDAI_ADMIN_USERNAME");
  const password = await getSetting("HOSTEDAI_ADMIN_PASSWORD");

  if (!url || !username || !password) {
    throw new Error(
      "HAI admin panel credentials not configured. " +
        "Set HOSTEDAI_ADMIN_URL, HOSTEDAI_ADMIN_USERNAME, HOSTEDAI_ADMIN_PASSWORD " +
        "in Platform Settings or .env.local."
    );
  }

  return { url: url.replace(/\/+$/, ""), username, password };
}

/**
 * Login to get session cookie
 */
async function login(): Promise<string> {
  const creds = await getAdminCredentials();
  console.log(`[HAI Admin] Logging in as ${creds.username}`);

  const response = await fetch(`${creds.url}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: creds.username,
      password: creds.password,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HAI Admin login failed (${response.status}): ${text}`);
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

  console.log(`[HAI Admin] Login successful, session established`);
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
 * Make an authenticated request to the HAI Admin API
 */
export async function gpuaasAdminRequest<T>(
  method: string,
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const cookie = await ensureSession();
  const creds = await getAdminCredentials();
  const url = `${creds.url}/api${endpoint}`;

  console.log(`[HAI Admin] ${method} ${url}`);
  if (data) {
    console.log(`[HAI Admin] Request body:`, JSON.stringify(data, null, 2));
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
    console.error(`[HAI Admin] API error ${response.status}:`, text);

    // Check if it's an auth error - re-login and retry once
    if (response.status === 401) {
      console.log(`[HAI Admin] Session expired, re-authenticating...`);
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
          `HAI Admin API error (${retryResponse.status}): ${retryText}`
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

    throw new Error(`HAI Admin API error (${response.status}): ${errorMessage}`);
  }

  if (!text) {
    console.log(`[HAI Admin] Empty response for: ${endpoint}`);
    return {} as T;
  }

  try {
    const parsed = JSON.parse(text);
    console.log(`[HAI Admin] Response:`, JSON.stringify(parsed, null, 2));
    return parsed;
  } catch {
    console.log(`[HAI Admin] Non-JSON response:`, text);
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
export async function getApiUrl(): Promise<string> {
  const creds = await getAdminCredentials();
  return creds.url;
}
