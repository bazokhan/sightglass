export type Summary = { operation: string; service: string; calls: number; errors: number; unauthorized: number; errorRate: number; averageMs: number; p50: number; p95: number; p99: number; dbShare: number };
export type OccurrenceRow = { id: string; operation: string; startedAt: string; durationMs: number; status: "success" | "error"; service: string; environment: string; traceId: string; context: Record<string, unknown>; error?: { message: string } };
export type Ranking = Record<string, string | number | null>;
export type Usage = { meter: string; unit: string | null; service: string; tenantId: string | null; quantity: number; events: number };
export type Trend = { hour: string; calls: number; errors: number; errorRate: number; averageMs: number; p95: number };
export type UsageTrend = { hour: string; meter: string; unit: string | null; quantity: number; events: number };
export type ServiceOption = { service: string; environment: string; lastSeen: string };
export type Health = { service: string; environment: string; timestamp: string; cpuPercent: number; memoryRssBytes: number; memoryHeapUsedBytes: number; eventLoopLagMs: number; uptimeSeconds: number; pid: number; hostMemoryTotalBytes?: number; hostMemoryFreeBytes?: number; hostLoad1m?: number; diskTotalBytes?: number; diskFreeBytes?: number; restartDetected?: number; restartCount?: number };

export type User = { id: string; email: string; role: "admin" | "user"; mustChangePassword: boolean };
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
let csrfToken = "";
export const setCsrfToken = (value: string) => { csrfToken = value; };
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json"); if (csrfToken && options.method && options.method !== "GET") headers.set("x-csrf-token", csrfToken);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) { const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined; if (response.status === 401 && path !== "/api/v1/auth/me" && !path.endsWith("/login")) window.location.reload(); throw new ApiError(response.status, body?.error?.message ?? `Sightglass API returned ${response.status}`); }
  if (response.status === 204) return undefined as T; return response.json() as Promise<T>;
}
const get = <T,>(path: string) => request<T>(path);

export const authApi = {
  me: () => request<{ user: User; csrfToken: string }>("/api/v1/auth/me"),
  setupStatus: () => request<{ required: boolean }>("/api/v1/auth/setup-status"),
  login: (email: string, password: string) => request<{ user: User; csrfToken: string }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  setup: (token: string, email: string, password: string) => request<{ user: User; csrfToken: string }>("/api/v1/auth/setup", { method: "POST", body: JSON.stringify({ token, email, password }) }),
  acceptInvite: (token: string, password: string) => request<void>("/api/v1/auth/invitations/accept", { method: "POST", body: JSON.stringify({ token, password }) }),
  reset: (token: string, password: string) => request<void>("/api/v1/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  forgot: (email: string) => request<void>("/api/v1/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  changePassword: (currentPassword: string, password: string) => request<void>("/api/v1/auth/password/change", { method: "POST", body: JSON.stringify({ currentPassword, password }) }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
};

export const adminApi = {
  overview: () => request<any>("/api/v1/admin/overview"),
  createUser: (email: string, role: string) => request<any>("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ email, role }) }),
  updateUser: (id: string, changes: object) => request<void>(`/api/v1/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  invite: (email: string, role: string) => request<any>("/api/v1/admin/invitations", { method: "POST", body: JSON.stringify({ email, role }) }),
  createKey: (name: string) => request<any>("/api/v1/admin/ingestion-keys", { method: "POST", body: JSON.stringify({ name }) }),
  revokeKey: (id: string) => request<void>(`/api/v1/admin/ingestion-keys/${id}`, { method: "DELETE" }),
  saveSmtp: (value: object) => request<any>("/api/v1/admin/settings/smtp", { method: "PUT", body: JSON.stringify(value) }),
  testSmtp: () => request<void>("/api/v1/admin/settings/smtp/test", { method: "POST" }),
  saveAlerts: (value: object) => request<any>("/api/v1/admin/settings/alerts", { method: "PUT", body: JSON.stringify(value) }),
  saveBackups: (value: object) => request<any>("/api/v1/admin/settings/backups", { method: "PUT", body: JSON.stringify(value) }),
  backupNow: () => request<any>("/api/v1/admin/backups", { method: "POST" }),
  checkUpdate: () => request<any>("/api/v1/admin/update/check", { method: "POST" }),
};

export function loadDashboard(hours: number, filters: { service: string; environment: string }) {
  const from = new Date(Date.now() - hours * 3_600_000).toISOString();
  const parameters = new URLSearchParams({ from });
  if (filters.service) parameters.set("service", filters.service);
  if (filters.environment) parameters.set("environment", filters.environment);
  const query = `?${parameters}`;
  return Promise.all([
    get<Summary[]>(`/api/v1/summary${query}`),
    get<Trend[]>(`/api/v1/trend${query}`),
    get<OccurrenceRow[]>(`/api/v1/occurrences${query}`),
    get<Ranking[]>(`/api/v1/database${query}`),
    get<Ranking[]>(`/api/v1/dependencies${query}`),
    get<Usage[]>(`/api/v1/usage${query}`),
    get<UsageTrend[]>(`/api/v1/usage/trend${query}`),
    get<Health[]>(`/api/v1/health${query}`),
    get<ServiceOption[]>("/api/v1/services"),
  ]).then(([summary, trend, occurrences, database, dependencies, usage, usageTrend, health, services]) => ({ summary, trend, occurrences, database, dependencies, usage, usageTrend, health, services, from, query: parameters.toString() }));
}

export const loadOccurrence = (id: string) => get<Record<string, any>>(`/api/v1/occurrences/${encodeURIComponent(id)}`);
