const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { reason?: string; error?: boolean; code?: string } | null;
    throw new APIError(payload?.reason ?? `API request failed: ${response.status}`, response.status, payload?.code);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
