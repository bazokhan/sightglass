export type Summary = { operation: string; service: string; calls: number; errors: number; unauthorized: number; errorRate: number; averageMs: number; p50: number; p95: number; p99: number; dbShare: number };
export type OccurrenceRow = { id: string; operation: string; startedAt: string; durationMs: number; status: "success" | "error"; service: string; environment: string; traceId: string; context: Record<string, unknown>; error?: { message: string } };
export type Ranking = Record<string, string | number | null>;
export type Usage = { meter: string; unit: string | null; service: string; tenantId: string | null; quantity: number; events: number };
export type Health = { service: string; environment: string; timestamp: string; cpuPercent: number; memoryRssBytes: number; memoryHeapUsedBytes: number; eventLoopLagMs: number; uptimeSeconds: number; pid: number };

const get = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Sightglass API returned ${response.status}`);
  return response.json() as Promise<T>;
};

export function loadDashboard(hours: number) {
  const from = new Date(Date.now() - hours * 3_600_000).toISOString();
  const query = `?from=${encodeURIComponent(from)}`;
  return Promise.all([
    get<Summary[]>(`/api/v1/summary${query}`),
    get<OccurrenceRow[]>(`/api/v1/occurrences${query}`),
    get<Ranking[]>(`/api/v1/database${query}`),
    get<Ranking[]>(`/api/v1/dependencies${query}`),
    get<Usage[]>(`/api/v1/usage${query}`),
    get<Health[]>(`/api/v1/health${query}`),
  ]).then(([summary, occurrences, database, dependencies, usage, health]) => ({ summary, occurrences, database, dependencies, usage, health, from }));
}

export const loadOccurrence = (id: string) => get<Record<string, any>>(`/api/v1/occurrences/${encodeURIComponent(id)}`);
