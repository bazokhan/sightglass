# Sightglass

**Application observability for developers who don't want an observability stack.**

Sightglass is an opt-in observability tool for Node.js applications. Nothing is collected when you install it. You explicitly mark important operations—checkout, report generation, payments, background jobs—and Sightglass records one compact, useful occurrence with its business context, meaningful events, database work, outbound calls, errors, and exact usage.

See the [reproducible benchmarks](docs/BENCHMARKS.md) and [focused comparison with 10 alternatives](docs/COMPARISON.md).

## Run Sightglass

```bash
docker compose up --build
```

Open [http://localhost:7777](http://localhost:7777). Data is stored in one Docker volume backed by SQLite.

For local development:

```bash
npm install
npm run build
npm start
```

## Install the SDK

Registry installation, once the packages are published:

```bash
npm install @sightglass/core @sightglass/express
```

For a source checkout or private release, run `npm run build && npm run pack:sdk`. Install the required `.tgz` files from `dist-packages/` into the application. Choose only the framework adapter the application uses; every adapter depends on `@sightglass/core`.

## Express

```ts
import { configureSightglass, observe as sightglass } from "@sightglass/core";
import { observe } from "@sightglass/express";

configureSightglass({
  service: "billing-api",
  endpoint: "http://sightglass:7777",
  meters: { "orders.created": { unit: "order" } }
});

app.post("/checkout", observe("checkout"), async (request, response) => {
  sightglass.set({ tenantId: request.user.tenantId, plan: "pro" });
  await sightglass.step("calculate-price", calculatePrice);
  sightglass.event("payment.authorized", { provider: "stripe" });
  sightglass.meter("orders.created", 1, { tenantId: request.user.tenantId });
  response.sendStatus(201);
});
```

Unwrapped routes remain completely silent.

## NestJS

```ts
@Module({
  imports: [SightglassModule.forRoot({ service: "billing-api", endpoint: "http://sightglass:7777" })]
})
export class AppModule {}

@Observe("checkout")
@Post("checkout")
checkout() { /* ... */ }
```

`@Observe()` also works at controller level; use `@NoObserve()` on excluded methods. The module registers the interceptor globally.

## Next.js route handlers

```ts
import { observe } from "@sightglass/next";

export const POST = observe("checkout", async (request) => {
  return Response.json({ ok: true });
});
```

Sightglass does not automatically observe page rendering, RSC, static files, prefetching, or browser activity. Server Actions are intentionally unsupported because reliable route-level semantics cannot be guaranteed.

## tsoa

Use the `@Observe()` method decorator from `@sightglass/express`. It wraps the generated controller call and reuses the same operation engine. Add `experimentalDecorators: true` to TypeScript configuration. For HTTP route/status metadata, use the Express middleware on selected routes after `RegisterRoutes(app)`.

## Prisma

```ts
import { withSightglass } from "@sightglass/prisma";
const prisma = withSightglass(new PrismaClient());
```

The Client extension uses Prisma's current query-extension API. Inside an observed operation it records `Order.findMany`-style model/action timing. It never stores SQL, bind parameters, or results.

## Configuration

SDK options include service, endpoint, environment, API key, batching bounds, timeouts, retry bounds, meter spool directory, meter units, fetch instrumentation, and health interval. The defaults are deliberately conservative: batches of 25, a 2-second flush, 1,000 queued occurrences, 3-second network timeout, exponential retries from 500 ms to 60 seconds, and 60-second health sampling.

Server environment variables: `SIGHTGLASS_PORT`, `SIGHTGLASS_DATABASE_PATH`, `SIGHTGLASS_API_KEY`, `SIGHTGLASS_SUCCESS_RETENTION_DAYS`, `SIGHTGLASS_ERROR_RETENTION_DAYS`, and `SIGHTGLASS_AGGREGATE_RETENTION_DAYS`.

`SIGHTGLASS_API_KEY` authenticates ingestion, not dashboard reads. Bind or expose Sightglass only on a trusted private network, or place it behind an authenticating reverse proxy. See [operations](docs/OPERATIONS.md) before production deployment.

See [product doctrine](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [API reference](docs/API.md), [operations](docs/OPERATIONS.md), [protocol](docs/PROTOCOL.md), [reproducible benchmarks](docs/BENCHMARKS.md), and the [focused market comparison](docs/COMPARISON.md).

## Development

```bash
npm test
npm run typecheck
npm run build
npm run lint
```

Node.js 22.13 or newer is required for the built-in SQLite module. Sightglass is licensed under MIT.
