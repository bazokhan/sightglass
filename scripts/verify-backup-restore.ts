import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { Store } from "../apps/server/src/database.js";
import type { HealthSample, IngestEnvelope, Occurrence, UsageEvent } from "../packages/core/src/types.js";

const directory = mkdtempSync(join(tmpdir(), "sightglass-recovery-"));
const sourcePath = join(directory, "source.sqlite");
const backupPath = join(directory, "online-backup.sqlite");
const restoredPath = join(directory, "restored.sqlite");
const timestamp = "2026-08-15T12:00:00.000Z";

try {
  const source = new Store(sourcePath);
  source.ingest(payload(timestamp));
  await backup(source.database, backupPath);
  source.database.close();

  copyFileSync(backupPath, restoredPath);
  const restored = new Store(restoredPath);
  assert(restored.schemaVersion() === 3, "schema migrations");
  assert((restored.summary("2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z") as unknown[]).length === 1, "operation aggregates");
  assert(restored.occurrence("recovery-occurrence") !== undefined, "raw occurrence and trace payload");
  assert((restored.databaseRanking("2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z") as unknown[]).length === 1, "database aggregates");
  assert((restored.dependencyRanking("2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z") as unknown[]).length === 1, "dependency aggregates");
  assert((restored.usage("2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z") as unknown[]).length === 1, "exact meter totals");
  assert(restored.usageRows("2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z").length === 1, "exact meter rows");
  assert((restored.health("2026-08-15T00:00:00.000Z", "2026-08-16T00:00:00.000Z") as unknown[]).length === 1, "health history");
  restored.database.close();
  console.log("Sightglass backup/restore verification passed: raw telemetry, aggregates, exact meters, health, and schema restored.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function assert(condition: boolean, area: string): void { if (!condition) throw new Error(`Recovery verification failed: ${area}`); }

function payload(startedAt: string): IngestEnvelope {
  const occurrence: Occurrence = { id: "recovery-occurrence", operation: "checkout", startedAt, durationMs: 125, status: "success", service: "recovery-api", environment: "verification", request: { method: "POST", route: "/checkout", statusCode: 201 }, context: { tenantId: "tenant-recovery" }, database: { queryCount: 1, totalDurationMs: 30, operations: [{ id: "recovery-db", model: "Order", action: "create", atMs: 5, durationMs: 30, status: "success" }] }, dependencies: [{ id: "recovery-dependency", host: "payments.example", method: "POST", path: "/charge", atMs: 40, durationMs: 50, statusCode: 200, status: "success" }], events: [], steps: [], usage: ["recovery-meter"], runtime: { pid: 1, uptimeSeconds: 10, memoryRssBytes: 1_000, memoryHeapUsedBytes: 500 }, distributed: { traceId: "a".repeat(32), spanId: "b".repeat(16) } };
  const meter: UsageEvent = { id: "recovery-meter", occurrenceId: occurrence.id, timestamp: startedAt, service: occurrence.service, environment: occurrence.environment, meter: "orders.created", quantity: 1, unit: "order", tenantId: "tenant-recovery", attributes: {} };
  const health: HealthSample = { id: "recovery-health", service: occurrence.service, environment: occurrence.environment, timestamp: startedAt, cpuPercent: 4, memoryRssBytes: 1_000, memoryHeapUsedBytes: 500, eventLoopLagMs: 1, uptimeSeconds: 10, pid: 1 };
  return { protocol: 1, occurrences: [occurrence], meters: [meter], health: [health] };
}
