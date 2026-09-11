import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { statfsSync } from "node:fs";
import { freemem, loadavg, totalmem } from "node:os";
import { boundedAttributes, boundedName, LIMITS, normalizePath } from "./limits.js";
import { createTrace, traceparent } from "./trace.js";
import { Transport } from "./transport.js";
import type { Attributes, DatabaseOperation, DependencyOperation, HealthSample, Occurrence, OperationOptions, SightglassConfig } from "./types.js";

export * from "./types.js";
export { LIMITS, normalizePath } from "./limits.js";

interface ActiveOperation {
  occurrence: Occurrence;
  startedNs: bigint;
}

const storage = new AsyncLocalStorage<ActiveOperation>();
let transport: Transport | undefined;
let settings: (SightglassConfig & { environment: string }) | undefined;
let originalFetch: typeof globalThis.fetch | undefined;
let healthTimer: NodeJS.Timeout | undefined;
let healthHistogram: ReturnType<typeof monitorEventLoopDelay> | undefined;

export function configureSightglass(config: SightglassConfig): void {
  if (!config.service.trim()) throw new TypeError("Sightglass service is required");
  if (!config.endpoint.trim()) throw new TypeError("Sightglass endpoint is required");
  if (transport) void transport.close();
  settings = { ...config, environment: config.environment ?? process.env.NODE_ENV ?? "development" };
  transport = new Transport({
    ...settings,
    batchSize: config.batchSize ?? 25,
    flushIntervalMs: config.flushIntervalMs ?? 2_000,
    maxQueueSize: config.maxQueueSize ?? 1_000,
    requestTimeoutMs: config.requestTimeoutMs ?? 3_000,
    retryBaseMs: config.retryBaseMs ?? 500,
    retryMaxMs: config.retryMaxMs ?? 60_000,
    meterSpoolDirectory: config.meterSpoolDirectory === undefined ? ".sightglass-spool" : config.meterSpoolDirectory,
  });
  if (config.fetchInstrumentation !== false) installFetchInstrumentation();
  else restoreFetch();
  if (healthTimer) clearInterval(healthTimer);
  healthHistogram?.disable();
  if (config.healthIntervalMs !== false) startHealth(config.healthIntervalMs ?? 60_000);
}

export async function shutdownSightglass(): Promise<void> {
  if (healthTimer) clearInterval(healthTimer);
  healthHistogram?.disable();
  await transport?.close();
  restoreFetch();
}

export async function runObserved<T>(name: string, options: OperationOptions, fn: () => T | Promise<T>): Promise<T> {
  if (!settings || !transport) return await fn();
  const parent = storage.getStore();
  const distributed = createTrace(options.traceparent ?? (parent ? traceparent(parent.occurrence.distributed.traceId, parent.occurrence.distributed.spanId) : undefined));
  const startedNs = process.hrtime.bigint();
  const occurrence: Occurrence = {
    id: randomUUID(),
    operation: boundedName(name, "operation"),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: "success",
    service: settings.service,
    environment: settings.environment,
    ...(options.request ? { request: { ...options.request, method: options.request.method.toUpperCase(), route: normalizePath(options.request.route) } } : {}),
    context: {},
    database: { queryCount: 0, totalDurationMs: 0, operations: [] },
    dependencies: [], events: [], steps: [], usage: [],
    runtime: runtimeSnapshot(),
    distributed,
  };
  const active: ActiveOperation = { occurrence, startedNs };
  try {
    return await storage.run(active, fn);
  } catch (error) {
    occurrence.status = "error";
    occurrence.error = serializeError(error);
    throw error;
  } finally {
    occurrence.durationMs = elapsedMs(startedNs);
    transport.enqueueOccurrence(occurrence);
  }
}

type ObservedHandler<TArgs extends unknown[], TResult> = (...args: TArgs) => TResult | Promise<TResult>;

function observeFunction<TArgs extends unknown[], TResult>(name: string, handler: ObservedHandler<TArgs, TResult>): (...args: TArgs) => Promise<TResult> {
  return (...args) => runObserved(name, {}, () => handler(...args));
}

interface ObserveApi {
  <TArgs extends unknown[], TResult>(name: string, handler: ObservedHandler<TArgs, TResult>): (...args: TArgs) => Promise<TResult>;
  <TArgs extends unknown[], TResult>(handler: ObservedHandler<TArgs, TResult>): (...args: TArgs) => Promise<TResult>;
  set(attributes: Attributes): void;
  event(name: string, attributes?: Attributes): void;
  meter(name: string, quantity: number, attributes?: Attributes & { tenantId?: string }): string | undefined;
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
}

export const observe: ObserveApi = Object.assign(
  <TArgs extends unknown[], TResult>(nameOrHandler: string | ObservedHandler<TArgs, TResult>, maybeHandler?: ObservedHandler<TArgs, TResult>) => {
    const handler = typeof nameOrHandler === "function" ? nameOrHandler : maybeHandler;
    if (!handler) throw new TypeError("observe requires a handler");
    return observeFunction(typeof nameOrHandler === "string" ? nameOrHandler : handler.name || "anonymous", handler);
  },
  {
    set(attributes: Attributes): void {
      const active = storage.getStore();
      if (active) active.occurrence.context = boundedAttributes({ ...active.occurrence.context, ...attributes });
    },
    event(name: string, attributes: Attributes = {}): void {
      const active = storage.getStore();
      if (!active || active.occurrence.events.length >= LIMITS.operationsPerCategory) return;
      active.occurrence.events.push({ id: randomUUID(), name: boundedName(name, "event"), atMs: elapsedMs(active.startedNs), attributes: boundedAttributes(attributes) });
    },
    meter(name: string, quantity: number, attributes: Attributes & { tenantId?: string } = {}): string | undefined {
      const active = storage.getStore();
      if (!active || !Number.isFinite(quantity) || quantity <= 0) return undefined;
      const id = randomUUID();
      const safe = boundedAttributes(attributes);
      const unit = settings?.meters?.[name]?.unit;
      const accepted = transport?.enqueueMeter({ id, occurrenceId: active.occurrence.id, timestamp: new Date().toISOString(), service: active.occurrence.service, environment: active.occurrence.environment, meter: boundedName(name, "meter"), quantity, ...(unit ? { unit } : {}), ...(typeof safe.tenantId === "string" ? { tenantId: safe.tenantId } : {}), attributes: safe });
      if (!accepted) return undefined;
      active.occurrence.usage.push(id);
      return id;
    },
    async step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
      const active = storage.getStore();
      if (!active || active.occurrence.steps.length >= LIMITS.operationsPerCategory) return await fn();
      const started = process.hrtime.bigint();
      const step = { id: randomUUID(), name: boundedName(name, "step"), atMs: elapsedMs(active.startedNs), durationMs: 0, status: "success" as const };
      try { return await fn(); }
      catch (error) { Object.assign(step, { status: "error", error: errorMessage(error) }); throw error; }
      finally { step.durationMs = elapsedMs(started); active.occurrence.steps.push(step); }
    },
  },
);

export function recordDatabase(model: string, action: string, startedNs: bigint, status: "success" | "error"): void {
  const active = storage.getStore();
  if (!active || active.occurrence.database.operations.length >= LIMITS.operationsPerCategory) return;
  const operation: DatabaseOperation = { id: randomUUID(), model: boundedName(model), action: boundedName(action), atMs: elapsedMs(active.startedNs), durationMs: elapsedMs(startedNs), status };
  active.occurrence.database.operations.push(operation);
  active.occurrence.database.queryCount += 1;
  active.occurrence.database.totalDurationMs += operation.durationMs;
}

export function activeTraceparent(): string | undefined {
  const active = storage.getStore();
  return active ? traceparent(active.occurrence.distributed.traceId, active.occurrence.distributed.spanId) : undefined;
}

export function isObserving(): boolean { return storage.getStore() !== undefined; }

export function setRequestStatus(statusCode: number): void {
  const request = storage.getStore()?.occurrence.request;
  if (request && Number.isInteger(statusCode)) request.statusCode = statusCode;
}

function installFetchInstrumentation(): void {
  if (originalFetch || typeof globalThis.fetch !== "function") return;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const active = storage.getStore();
    if (!active || !originalFetch || active.occurrence.dependencies.length >= LIMITS.operationsPerCategory) return originalFetch!(input, init);
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (settings && request.url.startsWith(settings.endpoint.replace(/\/$/, ""))) return originalFetch(request);
    const headers = new Headers(request.headers);
    headers.set("traceparent", activeTraceparent()!);
    const started = process.hrtime.bigint();
    const dependency: DependencyOperation = { id: randomUUID(), host: url.host, method: request.method, path: normalizePath(url.pathname), atMs: elapsedMs(active.startedNs), durationMs: 0, status: "success" };
    try {
      const response = await originalFetch(new Request(request, { headers }));
      dependency.statusCode = response.status;
      if (!response.ok) dependency.status = "error";
      return response;
    } catch (error) {
      dependency.status = "error";
      dependency.error = errorMessage(error).slice(0, 512);
      throw error;
    } finally {
      dependency.durationMs = elapsedMs(started);
      active.occurrence.dependencies.push(dependency);
    }
  }) as typeof fetch;
}

function restoreFetch(): void {
  if (!originalFetch) return;
  globalThis.fetch = originalFetch;
  originalFetch = undefined;
}

function startHealth(interval: number): void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  healthHistogram = histogram;
  histogram.enable();
  let previousCpu = process.cpuUsage();
  let previousAt = process.hrtime.bigint();
  healthTimer = setInterval(() => {
    if (!settings || !transport) return;
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(previousCpu);
    const elapsedMicros = Number(now - previousAt) / 1_000;
    const memory = process.memoryUsage();
    let disk: { diskTotalBytes?: number; diskFreeBytes?: number } = {};
    try {
      const stats = statfsSync(process.cwd());
      disk = { diskTotalBytes: Number(stats.blocks) * Number(stats.bsize), diskFreeBytes: Number(stats.bavail) * Number(stats.bsize) };
    } catch { /* disk telemetry is best effort */ }
    const sample: HealthSample = { id: randomUUID(), service: settings.service, environment: settings.environment, timestamp: new Date().toISOString(), cpuPercent: elapsedMicros ? ((cpu.user + cpu.system) / elapsedMicros) * 100 : 0, memoryRssBytes: memory.rss, memoryHeapUsedBytes: memory.heapUsed, eventLoopLagMs: Number(histogram.mean) / 1e6 || 0, uptimeSeconds: process.uptime(), pid: process.pid, hostMemoryTotalBytes: totalmem(), hostMemoryFreeBytes: freemem(), hostLoad1m: loadavg()[0] ?? 0, ...disk };
    previousCpu = process.cpuUsage(); previousAt = now; histogram.reset(); transport.enqueueHealth(sample);
  }, interval);
  healthTimer.unref();
}

function runtimeSnapshot() { const memory = process.memoryUsage(); return { pid: process.pid, uptimeSeconds: process.uptime(), memoryRssBytes: memory.rss, memoryHeapUsedBytes: memory.heapUsed }; }
function elapsedMs(started: bigint): number { return Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function serializeError(error: unknown): { type: string; message: string; stack?: string } {
  if (!(error instanceof Error)) return { type: "Error", message: String(error).slice(0, 512) };
  return { type: error.name.slice(0, 128), message: error.message.slice(0, 512), ...(error.stack ? { stack: error.stack.slice(0, LIMITS.stackLength) } : {}) };
}
