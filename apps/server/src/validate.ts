import type { HealthSample, IngestEnvelope, Occurrence, UsageEvent } from "@sightglass/core";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateEnvelope(input: unknown): IngestEnvelope {
  if (!isObject(input) || input.protocol !== 1) throw new Error("Unsupported ingestion protocol");
  if (!Array.isArray(input.occurrences) || !Array.isArray(input.meters) || !Array.isArray(input.health)) throw new Error("Envelope arrays are required");
  if (input.occurrences.length > 100 || input.meters.length > 500 || input.health.length > 100) throw new Error("Envelope batch is too large");
  for (const value of input.occurrences) validateOccurrence(value);
  for (const value of input.meters) validateMeter(value);
  for (const value of input.health) validateHealth(value);
  return input as unknown as IngestEnvelope;
}

function validateOccurrence(value: unknown): asserts value is Occurrence {
  if (!isObject(value) || !isText(value.id, 64) || !isText(value.operation, 128) || !isText(value.service, 128) || !isText(value.environment, 64)) throw new Error("Invalid occurrence identity");
  if (!isText(value.startedAt, 40) || !isFiniteNumber(value.durationMs) || !["success", "error"].includes(String(value.status))) throw new Error("Invalid occurrence timing or status");
  if (!isObject(value.context) || Object.keys(value.context).length > 32) throw new Error("Invalid occurrence context");
  if (!Array.isArray(value.events) || !Array.isArray(value.steps) || !Array.isArray(value.dependencies) || !isObject(value.database)) throw new Error("Invalid occurrence detail");
  if (value.events.length > 64 || value.steps.length > 64 || value.dependencies.length > 64) throw new Error("Occurrence detail is too large");
}

function validateMeter(value: unknown): asserts value is UsageEvent {
  if (!isObject(value) || !isText(value.id, 64) || !isText(value.occurrenceId, 64) || !isText(value.meter, 128) || !isText(value.service, 128)) throw new Error("Invalid meter identity");
  if (!isFiniteNumber(value.quantity) || value.quantity <= 0 || !isText(value.timestamp, 40) || !isObject(value.attributes)) throw new Error("Invalid meter value");
}

function validateHealth(value: unknown): asserts value is HealthSample {
  if (!isObject(value) || !isText(value.id, 64) || !isText(value.service, 128) || !isText(value.timestamp, 40)) throw new Error("Invalid health sample");
  for (const key of ["cpuPercent", "memoryRssBytes", "memoryHeapUsedBytes", "eventLoopLagMs", "uptimeSeconds", "pid"]) if (!isFiniteNumber(value[key])) throw new Error("Invalid health metrics");
}
