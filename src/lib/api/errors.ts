// API Error Codes and Handlers

export const ErrorCodes = {
  // Authentication
  INVALID_API_KEY: "INVALID_API_KEY",
  EXPIRED_API_KEY: "EXPIRED_API_KEY",
  REVOKED_API_KEY: "REVOKED_API_KEY",
  MISSING_API_KEY: "MISSING_API_KEY",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",

  // Validation
  INVALID_REQUEST: "INVALID_REQUEST",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_FIELD_VALUE: "INVALID_FIELD_VALUE",

  // Resources
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  CONFLICT: "CONFLICT",

  // Rate limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Payment
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",

  // Server
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }

  static invalidApiKey(message = `Invalid API key. Please check your API key at ${process.env.NEXT_PUBLIC_APP_URL || ""}/dashboard and ensure you're using the correct key format (pk_live_xxx).`) {
    return new ApiError(ErrorCodes.INVALID_API_KEY, message, 401);
  }

  static expiredApiKey() {
    return new ApiError(ErrorCodes.EXPIRED_API_KEY, `API key has expired. Please generate a new key at ${process.env.NEXT_PUBLIC_APP_URL || ""}/dashboard`, 401);
  }

  static revokedApiKey() {
    return new ApiError(ErrorCodes.REVOKED_API_KEY, `API key has been revoked. Please generate a new key at ${process.env.NEXT_PUBLIC_APP_URL || ""}/dashboard`, 401);
  }

  static missingApiKey() {
    return new ApiError(ErrorCodes.MISSING_API_KEY, `API key is required. Add 'Authorization: Bearer pk_live_xxx' header. Get your key at ${process.env.NEXT_PUBLIC_APP_URL || ""}/dashboard`, 401);
  }

  static insufficientScope(required: string) {
    return new ApiError(
      ErrorCodes.INSUFFICIENT_SCOPE,
      `Insufficient permissions. Required scope: ${required}`,
      403
    );
  }

  static forbidden(message: string) {
    return new ApiError(
      ErrorCodes.INSUFFICIENT_SCOPE,
      message,
      403
    );
  }

  static invalidRequest(message: string, details?: Record<string, unknown>) {
    return new ApiError(ErrorCodes.INVALID_REQUEST, message, 400, details);
  }

  static missingField(field: string) {
    return new ApiError(
      ErrorCodes.MISSING_REQUIRED_FIELD,
      `Missing required field: ${field}`,
      400,
      { field }
    );
  }

  static invalidField(field: string, message: string) {
    return new ApiError(
      ErrorCodes.INVALID_FIELD_VALUE,
      message,
      400,
      { field }
    );
  }

  static notFound(resource: string, id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    return new ApiError(ErrorCodes.NOT_FOUND, message, 404);
  }

  static alreadyExists(resource: string) {
    return new ApiError(ErrorCodes.ALREADY_EXISTS, `${resource} already exists`, 409);
  }

  static conflict(message: string) {
    return new ApiError(ErrorCodes.CONFLICT, message, 409);
  }

  static rateLimitExceeded(retryAfter: number) {
    return new ApiError(
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      "Rate limit exceeded. Please try again later.",
      429,
      { retryAfter }
    );
  }

  static internal(message = "An internal error occurred") {
    return new ApiError(ErrorCodes.INTERNAL_ERROR, message, 500);
  }

  static serviceUnavailable(message = "Service temporarily unavailable") {
    return new ApiError(ErrorCodes.SERVICE_UNAVAILABLE, message, 503);
  }

  static paymentRequired(message = "Payment required") {
    return new ApiError(ErrorCodes.PAYMENT_REQUIRED, message, 402);
  }

  static insufficientBalance(message: string) {
    return new ApiError(ErrorCodes.INSUFFICIENT_BALANCE, message, 402);
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new ApiError(ErrorCodes.INVALID_REQUEST, message, 400, details);
  }
}
