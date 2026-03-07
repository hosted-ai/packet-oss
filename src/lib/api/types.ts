// API Types

export interface ApiKeyAuth {
  customerId: string;
  teamId: string;
  scopes: string[];
  keyId: string;
}

export interface ApiErrorData {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiResponse<T = unknown> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorResponse {
  error: ApiErrorData;
  meta: ApiMeta;
}

export interface PaginatedResponse<T = unknown> {
  data: T[];
  meta: ApiMeta;
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
}

// API Key creation
export interface CreateApiKeyRequest {
  name: string;
  expiresAt?: string; // ISO date string
  scopes?: string[];
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string; // Full key, shown only once
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
