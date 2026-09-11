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
    expect(store.databaseRanking("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toHaveLength(1);
    expect(store.dependencyRanking("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toHaveLength(1);
    store.database.close();
  });
});
