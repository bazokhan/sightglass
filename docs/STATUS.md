# Implementation status

## Complete

- Product doctrine, architecture, protocol, and developer documentation.
- AsyncLocalStorage SDK with bounded context, events, steps, durable meters, error capture, fetch enrichment, runtime health, batching, retries, and W3C correlation.
- Express/tsoa, NestJS, Next.js Route Handler, and Prisma integrations.
- Versioned/validated HTTP ingestion and one-file SQLite WAL persistence.
- Idempotent usage ledger with CSV/JSON export.
- Hourly aggregates, percentiles, database/dependency rankings, service health history, and scheduled retention.
- Opinionated responsive React dashboard served by the same process, including seven in-product documentation pages with copyable setup and integration examples.
- Docker/Compose single-container deployment and realistic Express example.
- Billing-grade durability at the instant `observe.meter()` is called, plus capped exponential retry with jitter and outage recovery coverage.
- Ordered SQLite migrations with legacy upgrade coverage and aggregate-backed operation, usage, database, and dependency queries.
- Reconstructed distributed operation trees in both the API and occurrence drawer.
- Process and host health with restart detection, strict nested ingestion validation, framework integration tests, and a repeatable ingestion benchmark.

## Commands to run

- Local: `npm install && npm run build && npm start`
- Example app: `npm run dev -w @sightglass/example`
- Verification: `npm test && npm run typecheck && npm run lint && npm run build && npm run benchmark`
- Container: `docker compose up --build`

## Known issues

- Next.js Server Actions are intentionally unsupported; use Route Handlers.
- tsoa's method decorator cannot attach HTTP route/status metadata; combine it with selected Express middleware where that detail is needed.
- Percentiles use a bounded 2,048-sample hourly reservoir rather than an external metrics database.
