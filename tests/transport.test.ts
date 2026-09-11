import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Transport } from "../packages/core/src/transport.js";
import type { UsageEvent } from "../packages/core/src/types.js";

const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });

describe("reliable transport", () => {
  it("spools meters synchronously and recovers after an outage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sightglass-spool-"));
    let attempts = 0;
    globalThis.fetch = (async () => { attempts += 1; if (attempts === 1) throw new Error("offline"); return new Response(null, { status: 202 }); }) as typeof fetch;
    const transport = new Transport({ service: "test", endpoint: "http://collector", batchSize: 100, flushIntervalMs: 60_000, maxQueueSize: 100, requestTimeoutMs: 100, retryBaseMs: 1, retryMaxMs: 2, meterSpoolDirectory: directory });
    const meter: UsageEvent = { id: "meter-durable", occurrenceId: "pending-operation", timestamp: new Date().toISOString(), service: "test", environment: "test", meter: "units", quantity: 1, attributes: {} };
    transport.enqueueMeter(meter);
    expect(readdirSync(directory)).toEqual(["meter-durable.json"]);
    await transport.flush();
    await new Promise((resolve) => setTimeout(resolve, 3));
    await transport.flush();
    expect(attempts).toBe(2);
    expect(readdirSync(directory)).toHaveLength(0);
    await transport.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("recovers valid ledger files even when another spool entry is corrupt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sightglass-recovery-"));
    const meter: UsageEvent = { id: "valid", occurrenceId: "operation", timestamp: new Date().toISOString(), service: "test", environment: "test", meter: "units", quantity: 1, attributes: {} };
    writeFileSync(join(directory, "broken.json"), "{"); writeFileSync(join(directory, "valid.json"), JSON.stringify(meter));
    globalThis.fetch = (async () => new Response(null, { status: 202 })) as typeof fetch;
    const transport = new Transport({ service: "test", endpoint: "http://collector", batchSize: 100, flushIntervalMs: 60_000, maxQueueSize: 100, requestTimeoutMs: 100, retryBaseMs: 1, retryMaxMs: 2, meterSpoolDirectory: directory });
    await transport.close(); expect(readdirSync(directory)).toEqual(["broken.json"]); rmSync(directory, { recursive: true, force: true });
  });

  it("drains a disk backlog larger than the bounded in-memory queue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sightglass-backlog-")); const delivered: string[] = [];
    for (let index = 0; index < 7; index += 1) { const meter: UsageEvent = { id: `meter-${index}`, occurrenceId: "operation", timestamp: new Date().toISOString(), service: "test", environment: "test", meter: "units", quantity: 1, attributes: {} }; writeFileSync(join(directory, `${meter.id}.json`), JSON.stringify(meter)); }
    globalThis.fetch = (async (_input, init) => { const body = JSON.parse(String(init?.body)) as { meters: UsageEvent[] }; delivered.push(...body.meters.map((meter) => meter.id)); return new Response(null, { status: 202 }); }) as typeof fetch;
    const transport = new Transport({ service: "test", endpoint: "http://collector", batchSize: 2, flushIntervalMs: 60_000, maxQueueSize: 2, requestTimeoutMs: 100, retryBaseMs: 1, retryMaxMs: 2, meterSpoolDirectory: directory });
    await transport.close(); expect(new Set(delivered).size).toBe(7); expect(readdirSync(directory)).toHaveLength(0); rmSync(directory, { recursive: true, force: true });
  });
});
