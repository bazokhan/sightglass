export type Summary = { operation: string; service: string; calls: number; errors: number; unauthorized: number; errorRate: number; averageMs: number; p50: number; p95: number; p99: number; dbShare: number };
export type OccurrenceRow = { id: string; operation: string; startedAt: string; durationMs: number; status: "success" | "error"; service: string; environment: string; traceId: string; context: Record<string, unknown>; error?: { message: string } };
export type Ranking = Record<string, string | number | null>;
export type Usage = { meter: string; unit: string | null; service: string; tenantId: string | null; quantity: number; events: number };
export type Trend = { hour: string; calls: number; errors: number; errorRate: number; averageMs: number; p95: number };
export type UsageTrend = { hour: string; meter: string; unit: string | null; quantity: number; events: number };
export type ServiceOption = { service: string; environment: string; lastSeen: string };
export type Health = { service: string; environment: string; timestamp: string; cpuPercent: number; memoryRssBytes: number; memoryHeapUsedBytes: number; eventLoopLagMs: number; uptimeSeconds: number; pid: number; hostMemoryTotalBytes?: number; hostMemoryFreeBytes?: number; hostLoad1m?: number; diskTotalBytes?: number; diskFreeBytes?: number; restartDetected?: number; restartCount?: number };

const get = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Sightglass API returned ${response.status}`);
  return response.json() as Promise<T>;
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
