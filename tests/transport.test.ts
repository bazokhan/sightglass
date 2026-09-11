import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
});
