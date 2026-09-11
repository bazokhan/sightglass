export type Primitive = string | number | boolean | null;
export type Attributes = Record<string, Primitive>;

export interface RequestContext {
  method: string;
  route: string;
  statusCode?: number;
}

export interface SemanticEvent {
  id: string;
  name: string;
  atMs: number;
  attributes: Attributes;
}

export interface OperationStep {
  id: string;
  name: string;
  atMs: number;
  durationMs: number;
  status: "success" | "error";
  error?: string;
}

export interface DependencyOperation {
  id: string;
  host: string;
  method: string;
  path: string;
  atMs: number;
  durationMs: number;
  statusCode?: number;
  status: "success" | "error";
  error?: string;
}

export interface DatabaseOperation {
  id: string;
  model: string;
  action: string;
  atMs: number;
  durationMs: number;
  status: "success" | "error";
}

export interface UsageEvent {
  id: string;
  occurrenceId: string;
  timestamp: string;
  service: string;
  environment: string;
  meter: string;
  quantity: number;
  unit?: string;
  tenantId?: string;
  attributes: Attributes;
}

export interface RuntimeSnapshot {
  pid: number;
  uptimeSeconds: number;
  memoryRssBytes: number;
  memoryHeapUsedBytes: number;
}

export interface Occurrence {
  id: string;
  operation: string;
  startedAt: string;
  durationMs: number;
  status: "success" | "error";
  service: string;
  environment: string;
  request?: RequestContext;
  context: Attributes;
  error?: { type: string; message: string; stack?: string };
  database: { queryCount: number; totalDurationMs: number; operations: DatabaseOperation[] };
  dependencies: DependencyOperation[];
  events: SemanticEvent[];
  steps: OperationStep[];
  usage: string[];
  runtime: RuntimeSnapshot;
  distributed: { traceId: string; spanId: string; parentId?: string };
}

export interface HealthSample {
  id: string;
  service: string;
  environment: string;
  timestamp: string;
  cpuPercent: number;
  memoryRssBytes: number;
  memoryHeapUsedBytes: number;
  eventLoopLagMs: number;
  uptimeSeconds: number;
  pid: number;
  hostMemoryTotalBytes?: number;
  hostMemoryFreeBytes?: number;
  hostLoad1m?: number;
  diskTotalBytes?: number;
  diskFreeBytes?: number;
}

export interface IngestEnvelope {
  protocol: 1;
  occurrences: Occurrence[];
  meters: UsageEvent[];
  health: HealthSample[];
}

export interface SightglassConfig {
  service: string;
  endpoint: string;
  environment?: string;
  apiKey?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  requestTimeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  meterSpoolDirectory?: string | false;
  fetchInstrumentation?: boolean;
  healthIntervalMs?: number | false;
  meters?: Record<string, { unit: string }>;
  onTelemetryError?: (error: Error, area: "transport" | "meter-spool") => void;
}

export interface OperationOptions {
  request?: RequestContext;
  traceparent?: string;
}
