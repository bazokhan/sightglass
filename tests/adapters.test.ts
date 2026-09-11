import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureSightglass, runObserved, shutdownSightglass } from "@sightglass/core";
import type { IngestEnvelope } from "../packages/core/src/types.js";
import { observe as observeNext } from "../packages/next/src/index.js";
import { withSightglass } from "../packages/prisma/src/index.js";

const envelopes: IngestEnvelope[] = [];
const nativeFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => { if (init?.body) envelopes.push(JSON.parse(String(init.body)) as IngestEnvelope); return new Response(null, { status: 202 }); }) as typeof fetch;
  configureSightglass({ service: "adapter-test", endpoint: "http://collector", batchSize: 100, fetchInstrumentation: false, healthIntervalMs: false, meterSpoolDirectory: false });
});
afterAll(async () => { await shutdownSightglass(); globalThis.fetch = nativeFetch; });

describe("framework adapters", () => {
  it("wraps a Next route without observing unrelated work", async () => {
    const handler = observeNext("api.checkout", async () => new Response("created", { status: 201 }));
    const response = await handler(new Request("https://shop.test/orders/123"), {});
    expect(response.status).toBe(201); await shutdownSightglass();
    expect(envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "api.checkout")?.request).toMatchObject({ method: "GET", route: "/orders/:id", statusCode: 201 });
  });

  it("records Prisma model actions only within an active operation", async () => {
    let hook: ((input: { model: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) => Promise<unknown>) | undefined;
    withSightglass({ $extends(extension: any) { hook = extension.query.$allModels.$allOperations; return {}; } });
    await hook!({ model: "User", operation: "findMany", args: {}, query: async () => [] });
    await runObserved("users.list", {}, () => hook!({ model: "User", operation: "findMany", args: {}, query: async () => [] }));
    await shutdownSightglass();
    const operation = envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "users.list");
    expect(operation?.database.operations).toHaveLength(1); expect(operation?.database.operations[0]).toMatchObject({ model: "User", action: "findMany" });
  });
});
