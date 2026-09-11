import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Store } from "../apps/server/src/database.js";
import type { Occurrence } from "../packages/core/src/types.js";

const count = Number(process.env.SIGHTGLASS_BENCHMARK_COUNT ?? 10_000);
const store = new Store(":memory:");
const started = performance.now();
for (let offset = 0; offset < count; offset += 100) {
  const occurrences = Array.from({ length: Math.min(100, count - offset) }, (_, index) => sample(offset + index));
  store.ingest({ protocol: 1, occurrences, meters: [], health: [] });
}
const elapsedMs = performance.now() - started;
const rate = Math.round(count / (elapsedMs / 1_000));
const summaryStarted = performance.now();
store.summary("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
const summaryMs = performance.now() - summaryStarted;
console.log(JSON.stringify({ occurrences: count, ingestMs: Math.round(elapsedMs), occurrencesPerSecond: rate, summaryMs: Math.round(summaryMs * 100) / 100 }));
store.database.close();

function sample(index: number): Occurrence {
  return { id: randomUUID(), operation: `operation.${index % 20}`, startedAt: new Date().toISOString(), durationMs: 10 + index % 200, status: index % 50 ? "success" : "error", service: `service-${index % 4}`, environment: "benchmark", context: { tenantId: `tenant-${index % 100}` }, database: { queryCount: 1, totalDurationMs: 4, operations: [{ id: randomUUID(), model: "Record", action: "findMany", atMs: 1, durationMs: 4, status: "success" }] }, dependencies: [{ id: randomUUID(), host: "api.example", method: "GET", path: "/records/:id", atMs: 5, durationMs: 3, status: "success", statusCode: 200 }], events: [], steps: [], usage: [], runtime: { pid: 1, uptimeSeconds: 1, memoryRssBytes: 1, memoryHeapUsedBytes: 1 }, distributed: { traceId: randomUUID().replaceAll("-", ""), spanId: randomUUID().replaceAll("-", "").slice(0, 16) } };
}
