import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Store } from "../apps/server/src/database.js";
import type { IngestEnvelope, Occurrence, UsageEvent } from "../packages/core/src/types.js";

function occurrence(): Occurrence {
  return { id: "occ-1", operation: "checkout", startedAt: new Date().toISOString(), durationMs: 120, status: "error", service: "shop", environment: "test", context: { tenantId: "tenant-1" }, database: { queryCount: 1, totalDurationMs: 40, operations: [{ id: "db-1", model: "Order", action: "create", atMs: 10, durationMs: 40, status: "success" }] }, dependencies: [{ id: "dep-1", host: "payments.example", method: "POST", path: "/charge", atMs: 50, durationMs: 60, status: "error", statusCode: 503 }], events: [], steps: [], usage: ["meter-1"], runtime: { pid: 1, uptimeSeconds: 10, memoryRssBytes: 100, memoryHeapUsedBytes: 50 }, distributed: { traceId: "a".repeat(32), spanId: "b".repeat(16) } };
}

function meter(timestamp: string): UsageEvent { return { id: "meter-1", occurrenceId: "occ-1", timestamp, service: "shop", environment: "test", meter: "orders.created", quantity: 1, unit: "order", tenantId: "tenant-1", attributes: { tenantId: "tenant-1" } }; }

describe("SQLite store", () => {
  it("ingests transactionally and deduplicates occurrence and meter IDs", () => {
    const store = new Store(":memory:"); const item = occurrence(); const payload: IngestEnvelope = { protocol: 1, occurrences: [item], meters: [meter(item.startedAt)], health: [] };
    store.ingest(payload); store.ingest(payload);
    const summary = store.summary("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z") as Array<Record<string, number>>;
    expect(summary[0]?.calls).toBe(1); expect(summary[0]?.errors).toBe(1);
    expect(store.usage("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toHaveLength(1);
    expect(store.trend("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toMatchObject([{ calls: 1, errors: 1, errorRate: 100, p95: 120 }]);
    expect(store.usageTrend("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toMatchObject([{ meter: "orders.created", quantity: 1, events: 1 }]);
    expect(store.databaseRanking("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toHaveLength(1);
    expect(store.dependencyRanking("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toHaveLength(1);
    expect(store.schemaVersion()).toBe(2);
    expect((store.databaseRanking("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z") as Array<Record<string, unknown>>)[0]?.sourceOperation).toBe("checkout");
    store.database.close();
  });

  it("reconstructs a distributed operation tree and detects process restarts", () => {
    const store = new Store(":memory:"); const parent = occurrence(); const child = occurrence(); child.id = "occ-2"; child.service = "worker"; child.operation = "fulfill"; child.distributed = { traceId: parent.distributed.traceId, spanId: "c".repeat(16), parentId: parent.distributed.spanId }; child.database.operations = []; child.dependencies = []; child.usage = [];
    store.ingest({ protocol: 1, occurrences: [parent, child], meters: [], health: [health("health-1", 100, 40), health("health-2", 200, 2)] });
    expect(store.trace(parent.distributed.traceId)).toHaveLength(2);
    expect((store.occurrence(parent.id) as { distributedOccurrences: unknown[] }).distributedOccurrences).toHaveLength(2);
    const rows = store.health("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z") as Array<Record<string, number>>;
    expect(rows[1]?.restartDetected).toBe(1); expect(rows[1]?.restartCount).toBe(1); store.database.close();
  });

  it("upgrades a pre-migration database without losing existing health rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "sightglass-upgrade-")); const path = join(directory, "old.sqlite");
    const legacy = new DatabaseSync(path); legacy.exec("CREATE TABLE health_samples (id TEXT PRIMARY KEY, service TEXT NOT NULL, environment TEXT NOT NULL, timestamp TEXT NOT NULL, cpu_percent REAL NOT NULL, memory_rss_bytes INTEGER NOT NULL, heap_used_bytes INTEGER NOT NULL, event_loop_lag_ms REAL NOT NULL, uptime_seconds REAL NOT NULL, pid INTEGER NOT NULL); INSERT INTO health_samples VALUES ('legacy', 'api', 'prod', '2026-01-01T00:00:00.000Z', 1, 2, 1, 0, 10, 7)"); legacy.close();
    const store = new Store(path); expect(store.schemaVersion()).toBe(2); expect(store.health("2025-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")).toHaveLength(1); store.database.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("retains exact usage totals beyond ordinary aggregate retention", () => {
    const store = new Store(":memory:"); const old = "2020-01-01T00:00:00.000Z";
    store.ingest({ protocol: 1, occurrences: [], meters: [meter(old)], health: [] }); store.cleanup(1, 1, 1);
    expect(store.usage("2019-01-01T00:00:00.000Z", "2021-01-01T00:00:00.000Z")).toHaveLength(1); expect(store.usageRows("2019-01-01T00:00:00.000Z", "2021-01-01T00:00:00.000Z")).toHaveLength(1); store.database.close();
  });

  it("applies service and environment filters consistently", () => {
    const store = new Store(":memory:"); const first = occurrence(); const second = occurrence(); second.id = "occ-other"; second.service = "worker"; second.environment = "production"; second.database.operations = []; second.dependencies = []; second.usage = [];
    store.ingest({ protocol: 1, occurrences: [first, second], meters: [meter(first.startedAt)], health: [health("health-1", 1, 10)] });
    const range = ["2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z"] as const;
    expect(store.summary(...range, { service: "shop", environment: "test" })).toHaveLength(1);
    expect(store.summary(...range, { environment: "missing" })).toHaveLength(0);
    expect(store.occurrences({ from: range[0], to: range[1], environment: "production", limit: 50, offset: 0 })).toHaveLength(1);
    expect(store.databaseRanking(...range, { service: "worker" })).toHaveLength(0);
    expect(store.usage(...range, { service: "shop", environment: "test" })).toHaveLength(1);
    expect(store.usageRows(...range, { environment: "production" })).toHaveLength(0);
    expect(store.health(...range, { service: "shop", environment: "test" })).toHaveLength(1);
    expect(store.services()).toEqual(expect.arrayContaining([expect.objectContaining({ service: "shop", environment: "test" }), expect.objectContaining({ service: "worker", environment: "production" })]));
    store.database.close();
  });
});

function health(id: string, pid: number, uptimeSeconds: number) { return { id, service: "shop", environment: "test", timestamp: new Date(Date.now() + (id.endsWith("2") ? 1000 : 0)).toISOString(), cpuPercent: 1, memoryRssBytes: 2, memoryHeapUsedBytes: 1, eventLoopLagMs: 0, uptimeSeconds, pid, hostMemoryTotalBytes: 10, hostMemoryFreeBytes: 5, hostLoad1m: 0 }; }
