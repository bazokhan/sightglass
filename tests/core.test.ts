import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureSightglass, observe, runObserved, shutdownSightglass } from "../packages/core/src/index.js";
import type { IngestEnvelope } from "../packages/core/src/types.js";

const envelopes: IngestEnvelope[] = [];
const nativeFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) envelopes.push(JSON.parse(String(init.body)) as IngestEnvelope);
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
beforeEach(() => {
  envelopes.length = 0;
  configureSightglass({ service: "test-api", environment: "test", endpoint: "http://collector", batchSize: 100, fetchInstrumentation: false, healthIntervalMs: false, meterSpoolDirectory: false });
});

afterAll(async () => { await shutdownSightglass(); globalThis.fetch = nativeFetch; });

describe("operation context", () => {
  it("is silent outside explicit observation", () => {
    observe.set({ tenantId: "ignored" });
    observe.event("ignored");
    expect(observe.meter("ignored", 1)).toBeUndefined();
  });

  it("retains context through nested async work and records meaningful detail", async () => {
    await runObserved("checkout", {}, async () => {
      observe.set({ tenantId: "tenant_123", plan: "pro" });
      await Promise.resolve().then(() => observe.event("payment.authorized", { provider: "demo" }));
      await observe.step("calculate-price", async () => { await new Promise((resolve) => setTimeout(resolve, 2)); });
      expect(observe.meter("orders.created", 1, { tenantId: "tenant_123" })).toBeTypeOf("string");
    });
    await shutdownSightglass();
    const occurrence = envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "checkout");
    expect(occurrence?.context).toMatchObject({ tenantId: "tenant_123", plan: "pro" });
    expect(occurrence?.events[0]?.name).toBe("payment.authorized");
    expect(occurrence?.steps[0]?.status).toBe("success");
    expect(envelopes.flatMap((item) => item.meters)[0]?.tenantId).toBe("tenant_123");
  });

  it("captures errors and rethrows them", async () => {
    await expect(runObserved("failing-operation", {}, () => { throw new TypeError("boom"); })).rejects.toThrow("boom");
  });

  it("bounds high-cardinality context", async () => {
    await runObserved("bounded", {}, () => observe.set(Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`key-${index}`, "x".repeat(900)]))));
    await shutdownSightglass();
    const occurrence = envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "bounded");
    expect(Object.keys(occurrence?.context ?? {})).toHaveLength(32);
    expect(String(occurrence?.context["key-0"])).toHaveLength(512);
  });

  it("captures outbound fetch only while an operation is active", async () => {
    configureSightglass({ service: "test-api", environment: "test", endpoint: "http://collector", batchSize: 100, fetchInstrumentation: true, healthIntervalMs: false, meterSpoolDirectory: false });
    await fetch("https://outside.example/unobserved");
    await runObserved("calls-provider", {}, () => fetch("https://provider.example/customers/12345678?secret=nope"));
    await shutdownSightglass();
    const occurrence = envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "calls-provider");
    expect(occurrence?.dependencies).toHaveLength(1);
    expect(occurrence?.dependencies[0]).toMatchObject({ host: "provider.example", path: "/customers/:id" });
  });

  it("shuts down idempotently and stays silent until reconfigured", async () => {
    await runObserved("before-shutdown", {}, async () => undefined);
    await shutdownSightglass();
    await shutdownSightglass();
    await runObserved("after-shutdown", {}, async () => undefined);
    expect(envelopes.flatMap((item) => item.occurrences).map((item) => item.operation)).toEqual(["before-shutdown"]);

    configureSightglass({ service: "reconfigured", environment: "test", endpoint: "http://collector", batchSize: 100, fetchInstrumentation: false, healthIntervalMs: false, meterSpoolDirectory: false });
    await runObserved("after-reconfigure", {}, async () => undefined);
    await shutdownSightglass();
    expect(envelopes.flatMap((item) => item.occurrences).at(-1)?.service).toBe("reconfigured");
  });
});
