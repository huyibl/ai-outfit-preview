export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "method_not_allowed"
  | "payload_too_large"
  | "rate_limited"
  | "budget_exhausted"
  | "tryon_degraded"
  | "not_configured"
  | "upstream_failed"
  | "tryon_timeout";

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  rate_limited: 429,
  budget_exhausted: 429,
  tryon_degraded: 503,
  not_configured: 501,
  upstream_failed: 502,
  tryon_timeout: 504,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.extra = extra;
  }
}
