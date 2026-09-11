# Sightglass architecture

Sightglass is an npm-workspaces monorepo.

- `packages/core`: AsyncLocalStorage operation engine, small public API, fetch enrichment, W3C trace context, validation, bounded async transport, and durable meter spool.
- `packages/express`, `packages/nest`, `packages/next`: deliberately thin explicit-observation adapters.
- `packages/prisma`: Prisma Client extension that records normalized model/action timings only inside an active operation.
- `apps/server`: one Express process, Node's built-in SQLite database in WAL mode, migrations, ingestion, query/export APIs, aggregation, retention, low-frequency health storage, and static dashboard hosting.
- `apps/dashboard`: one React/Vite dashboard, built to static files and served by the server.

## Data flow

An explicit adapter opens an AsyncLocalStorage context. Enrichment APIs append bounded data to that occurrence. `observe.meter()` writes its ledger entry to a local spool before returning, so a process failure before operation completion does not lose usage. Completion queues the occurrence. The transport batches delivery with exponential backoff and jitter; spooled meters are removed only after an acknowledged idempotent ingest. The server strictly validates nested versioned payloads, writes them transactionally, and upserts hourly operation, usage, database, and dependency aggregates.

SQLite is the only persistence dependency. Occurrence JSON remains compact and supports detailed inspection; selected columns and aggregate tables provide indexed dashboard queries. Meter event IDs are primary keys, making ingestion retries safe.

Distributed correlation uses valid W3C `traceparent` headers. Fetch propagates trace identity while active. An explicitly observed downstream route accepts the parent header and creates a child occurrence; propagation never activates storage on its own. Stored trace relationships are reconstructed into a cross-service operation tree in occurrence detail and through `GET /api/v1/traces/:traceId`.

## API protocol

`POST /api/v1/ingest` accepts `{ occurrences, meters, health }` and returns accepted counts. Payloads are capped at 1 MiB and schema-validated. Ordered migrations are recorded in `schema_migrations`; upgrades backfill the aggregate schema without discarding raw data. Dashboard endpoints live below `/api/v1`, including operation summaries/details and traces, usage totals/export, dependency/database rankings, and process/host health.
