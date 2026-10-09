const TOKEN_KEY = "ai-outfit-preview:access-token";

export function getApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setApiToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略配额/隐私模式错误
  }
  unauthorizedListeners.forEach((cb) => cb(false));
}

type UnauthorizedListener = (value: boolean) => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function subscribeUnauthorized(cb: UnauthorizedListener) {
  unauthorizedListeners.add(cb);
  return () => {
    unauthorizedListeners.delete(cb);
  };
}

function flagUnauthorized() {
  unauthorizedListeners.forEach((cb) => cb(true));
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string | ApiErrorPayload };
}

function parseError(data: { error?: string | ApiErrorPayload }): string {
  const error = data.error;
  if (typeof error === "string") return error;
  return error?.message ?? "请求失败";
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const token = getApiToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    flagUnauthorized();
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string | ApiErrorPayload };
  return { ok: response.ok, status: response.status, data };
}

export function errorMessage(result: ApiResponse<unknown>): string {
  return parseError(result.data as { error?: string | ApiErrorPayload });
}
