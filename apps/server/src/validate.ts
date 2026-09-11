import type { Attributes, HealthSample, IngestEnvelope, Occurrence, UsageEvent } from "@sightglass/core";

type Value = Record<string, unknown>;
const object = (value: unknown): value is Value => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const date = (value: unknown): value is string => text(value, 40) && !Number.isNaN(Date.parse(value));
const status = (value: unknown) => value === "success" || value === "error";

function attributes(value: unknown): asserts value is Attributes {
  if (!object(value) || Object.keys(value).length > 32) throw new Error("Invalid attributes");
  for (const [key, item] of Object.entries(value)) if (!text(key, 128) || !(item === null || typeof item === "boolean" || (typeof item === "string" && item.length <= 512) || (typeof item === "number" && Number.isFinite(item)))) throw new Error("Invalid attribute value");
}

function detail(value: unknown, kind: "event" | "step" | "dependency" | "database"): void {
  if (!object(value) || !text(value.id, 64)) throw new Error(`Invalid ${kind} identity`);
  if (kind === "event") { if (!text(value.name, 128) || !number(value.atMs, 604_800_000)) throw new Error("Invalid event"); attributes(value.attributes); return; }
  if (!number(value.atMs, 604_800_000) || !number(value.durationMs, 604_800_000) || !status(value.status)) throw new Error(`Invalid ${kind} timing`);
  if (kind === "step" && !text(value.name, 128)) throw new Error("Invalid step");
  if (kind === "database" && (!text(value.model, 128) || !text(value.action, 128))) throw new Error("Invalid database operation");
  if (kind === "dependency" && (!text(value.host, 255) || !text(value.method, 16) || !text(value.path, 512) || (value.statusCode !== undefined && !number(value.statusCode, 599)))) throw new Error("Invalid dependency");
  if (value.error !== undefined && (typeof value.error !== "string" || value.error.length > 512)) throw new Error(`Invalid ${kind} error`);
}

export function validateEnvelope(input: unknown): IngestEnvelope {
  if (!object(input) || input.protocol !== 1) throw new Error("Unsupported ingestion protocol");
  if (!Array.isArray(input.occurrences) || !Array.isArray(input.meters) || !Array.isArray(input.health)) throw new Error("Envelope arrays are required");
  if (input.occurrences.length > 100 || input.meters.length > 500 || input.health.length > 100) throw new Error("Envelope batch is too large");
  input.occurrences.forEach(validateOccurrence); input.meters.forEach(validateMeter); input.health.forEach(validateHealth);
  return input as unknown as IngestEnvelope;
}

function validateOccurrence(value: unknown): asserts value is Occurrence {
  if (!object(value) || !text(value.id, 64) || !text(value.operation, 128) || !text(value.service, 128) || !text(value.environment, 64)) throw new Error("Invalid occurrence identity");
  if (!date(value.startedAt) || !number(value.durationMs, 604_800_000) || !status(value.status)) throw new Error("Invalid occurrence timing or status");
  attributes(value.context);
  if (!object(value.database) || !number(value.database.queryCount, 1_000_000) || !number(value.database.totalDurationMs, 604_800_000) || !Array.isArray(value.database.operations)) throw new Error("Invalid database detail");
  if (!Array.isArray(value.events) || !Array.isArray(value.steps) || !Array.isArray(value.dependencies) || !Array.isArray(value.usage) || value.events.length > 64 || value.steps.length > 64 || value.dependencies.length > 64 || value.database.operations.length > 64 || value.usage.length > 64) throw new Error("Occurrence detail is too large");
  value.events.forEach((item) => detail(item, "event")); value.steps.forEach((item) => detail(item, "step")); value.dependencies.forEach((item) => detail(item, "dependency")); value.database.operations.forEach((item) => detail(item, "database"));
  if (!value.usage.every((id) => text(id, 64)) || !object(value.runtime) || !number(value.runtime.pid) || !number(value.runtime.uptimeSeconds) || !number(value.runtime.memoryRssBytes) || !number(value.runtime.memoryHeapUsedBytes)) throw new Error("Invalid occurrence runtime");
  if (!object(value.distributed) || !text(value.distributed.traceId, 64) || !text(value.distributed.spanId, 64) || (value.distributed.parentId !== undefined && !text(value.distributed.parentId, 64))) throw new Error("Invalid distributed context");
  if (value.request !== undefined && (!object(value.request) || !text(value.request.method, 16) || !text(value.request.route, 512) || (value.request.statusCode !== undefined && !number(value.request.statusCode, 599)))) throw new Error("Invalid request context");
  if (value.error !== undefined && (!object(value.error) || !text(value.error.type, 128) || !text(value.error.message, 512) || (value.error.stack !== undefined && (typeof value.error.stack !== "string" || value.error.stack.length > 4096)))) throw new Error("Invalid occurrence error");
}

function validateMeter(value: unknown): asserts value is UsageEvent {
  if (!object(value) || !text(value.id, 64) || !text(value.occurrenceId, 64) || !text(value.meter, 128) || !text(value.service, 128) || !text(value.environment, 64)) throw new Error("Invalid meter identity");
  if (!number(value.quantity) || value.quantity <= 0 || !date(value.timestamp) || (value.unit !== undefined && !text(value.unit, 64)) || (value.tenantId !== undefined && !text(value.tenantId, 128))) throw new Error("Invalid meter value");
  attributes(value.attributes);
}

function validateHealth(value: unknown): asserts value is HealthSample {
  if (!object(value) || !text(value.id, 64) || !text(value.service, 128) || !text(value.environment, 64) || !date(value.timestamp)) throw new Error("Invalid health sample");
  for (const key of ["cpuPercent", "memoryRssBytes", "memoryHeapUsedBytes", "eventLoopLagMs", "uptimeSeconds", "pid"]) if (!number(value[key])) throw new Error("Invalid health metrics");
  for (const key of ["hostMemoryTotalBytes", "hostMemoryFreeBytes", "hostLoad1m", "diskTotalBytes", "diskFreeBytes"]) if (value[key] !== undefined && !number(value[key])) throw new Error("Invalid host health metrics");
}
