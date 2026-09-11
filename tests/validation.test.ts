import { describe, expect, it } from "vitest";
import { validateEnvelope } from "../apps/server/src/validate.js";

describe("ingestion validation", () => {
  it("rejects malformed nested telemetry", () => {
    expect(() => validateEnvelope({ protocol: 1, occurrences: [{ id: "x", operation: "bad", service: "s", environment: "e", startedAt: new Date().toISOString(), durationMs: 1, status: "success", context: {}, database: { queryCount: 0, totalDurationMs: 0, operations: [] }, dependencies: [{ id: "dep", host: "x" }], events: [], steps: [], usage: [], runtime: { pid: 1, uptimeSeconds: 1, memoryRssBytes: 1, memoryHeapUsedBytes: 1 }, distributed: { traceId: "t", spanId: "s" } }], meters: [], health: [] })).toThrow("dependency");
  });
});
