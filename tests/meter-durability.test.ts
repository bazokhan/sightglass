import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureSightglass, observe, runObserved, shutdownSightglass } from "../packages/core/src/index.js";

const nativeFetch = globalThis.fetch;
afterEach(async () => { await shutdownSightglass(); globalThis.fetch = nativeFetch; });

describe("meter durability boundary", () => {
  it("writes the ledger before an active operation finishes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sightglass-meter-"));
    globalThis.fetch = (async () => new Response(null, { status: 202 })) as typeof fetch;
    configureSightglass({ service: "billing", endpoint: "http://collector", batchSize: 100, fetchInstrumentation: false, healthIntervalMs: false, meterSpoolDirectory: directory });
    let release!: () => void; let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const operation = runObserved("generate", {}, async () => { observe.meter("documents", 1); ready(); await held; });
    await started;
    expect(readdirSync(directory)).toHaveLength(1);
    release(); await operation; await shutdownSightglass(); expect(readdirSync(directory)).toHaveLength(0);
    rmSync(directory, { recursive: true, force: true });
  });
});
