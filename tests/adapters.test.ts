import "reflect-metadata";
import { EventEmitter } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureSightglass, observe as coreObserve, runObserved, shutdownSightglass } from "@sightglass/core";
import type { IngestEnvelope } from "../packages/core/src/types.js";
import { Observe as ObserveExpress, observe as observeExpress } from "../packages/express/src/index.js";
import { Observe as ObserveNest, SightglassInterceptor } from "../packages/nest/src/index.js";
import { observe as observeNext } from "../packages/next/src/index.js";
import { withSightglass } from "../packages/prisma/src/index.js";
import { defer, lastValueFrom, of } from "rxjs";

const envelopes: IngestEnvelope[] = [];
const nativeFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => { if (init?.body) envelopes.push(JSON.parse(String(init.body)) as IngestEnvelope); return new Response(null, { status: 202 }); }) as typeof fetch;
  configureSightglass({ service: "adapter-test", endpoint: "http://collector", batchSize: 100, fetchInstrumentation: false, healthIntervalMs: false, meterSpoolDirectory: false });
});
afterAll(async () => { await shutdownSightglass(); globalThis.fetch = nativeFetch; });

describe("framework adapters", () => {
  it("observes selected Express middleware and records the final status", async () => {
    const request = { method: "POST", route: { path: "/checkout" }, path: "/checkout", header: () => undefined } as any;
    const response = Object.assign(new EventEmitter(), { statusCode: 202 }) as any;
    observeExpress("express.checkout")(request, response, () => { coreObserve.event("accepted"); response.emit("finish"); });
    await new Promise((resolve) => setImmediate(resolve)); await shutdownSightglass();
    expect(envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "express.checkout")?.request?.statusCode).toBe(202);
  });

  it("supports the tsoa-style method decorator", async () => {
    class Controller { async checkout() { coreObserve.event("decorated"); } }
    const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, "checkout")!; ObserveExpress("tsoa.checkout")(Controller.prototype, "checkout", descriptor); Object.defineProperty(Controller.prototype, "checkout", descriptor);
    await new Controller().checkout(); await shutdownSightglass();
    expect(envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "tsoa.checkout")?.events[0]?.name).toBe("decorated");
  });

  it("honors NestJS observation metadata through the interceptor", async () => {
    class Controller { handler() { return "ok"; } }
    const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, "handler")!; ObserveNest("nest.checkout")(Controller.prototype, "handler", descriptor);
    const context = { getHandler: () => Controller.prototype.handler, getClass: () => Controller, switchToHttp: () => ({ getRequest: () => ({ method: "POST", route: { path: "/checkout" }, url: "/checkout", headers: {} }), getResponse: () => ({ statusCode: 201 }) }) } as any;
    await lastValueFrom(new SightglassInterceptor().intercept(context, { handle: () => defer(() => { coreObserve.event("nest.completed"); return of("ok"); }) })); await shutdownSightglass();
    expect(envelopes.flatMap((item) => item.occurrences).find((item) => item.operation === "nest.checkout")?.events[0]?.name).toBe("nest.completed");
  });

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
