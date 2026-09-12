# Implementation status

## Important decisions

- Observation remains strictly opt-in; propagation never activates storage on an unwrapped route.
- SQLite WAL, one server process, one port, and one persistent volume remain the deployment boundary.
- Meter rows and compact meter totals are indefinite; ordinary raw and aggregate telemetry follows configured retention.
- Dashboard/read authentication belongs at the trusted-network or reverse-proxy boundary; the built-in API key protects ingestion.
- Next.js Server Actions remain intentionally unsupported because their semantics cannot be made reliable without violating explicit observation.

## Complete

- Product doctrine, architecture, protocol, benchmark, comparison, and developer documentation.
- AsyncLocalStorage SDK with bounded context, events, steps, durable meters, error capture, fetch enrichment, runtime health, batching, retries, and W3C correlation.
- Express/tsoa, Fastify, NestJS, Next.js Route Handler, and Prisma integrations.
- Versioned/validated HTTP ingestion and one-file SQLite WAL persistence.
- Idempotent usage ledger with CSV/JSON export.
- Hourly aggregates, percentiles, database/dependency rankings, service health history, and scheduled retention.
- Opinionated responsive React dashboard served by the same process, including operational trends, global service/environment filters, health sparklines, usage trends, and twelve in-product documentation pages.
- Docker/Compose single-container deployment and realistic Express example.
- Billing-grade durability at the instant `observe.meter()` is called, plus capped exponential retry with jitter and outage recovery coverage.
- Ordered SQLite migrations with legacy upgrade coverage and aggregate-backed operation, usage, database, and dependency queries.
- Reconstructed distributed operation trees in both the API and occurrence drawer.
- Process and host health with restart detection, strict nested ingestion validation, framework integration tests, and a repeatable ingestion benchmark.
- Bounded, drainable disk-backed meter recovery for outage backlogs larger than memory, with a non-fatal diagnostic callback.
- Indefinite exact meter rows and aggregate totals, plus persistent restart counts across the selected health range.
- Distributed operation trees containing correlated services and each service's database/dependency children.
- Express, tsoa, NestJS, Next.js, Prisma, HTTP server, documentation, retention, migration, and outage integration coverage.
- Publishable SDK tarballs with a clean-project installation check.
- Twelve in-product documentation pages plus API, benchmark, comparison, and production operations references covering installation, configuration, evidence, security, backup, upgrades, and verified recovery.
- Idempotent SDK shutdown and reconfiguration semantics, automatic NestJS/Fastify lifecycle drains, CI verification, and an executable online backup/restore proof.

## Commands to run

- Local: `npm install && npm run build && npm start`
- Example app: `npm run dev -w @sightglass/example`
- Verification: `npm test && npm run typecheck && npm run lint && npm run build && npm run benchmark`
- Container: `docker compose up --build`

## Known issues

- Next.js Server Actions are intentionally unsupported; use Route Handlers.
- tsoa's method decorator cannot attach HTTP route/status metadata; combine it with selected Express middleware where that detail is needed.
- Percentiles use a bounded 2,048-sample hourly reservoir rather than an external metrics database.
