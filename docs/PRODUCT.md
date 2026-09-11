# Sightglass product

Sightglass is application observability for developers who do not want an observability stack. It records only explicitly observed business operations. Installing an SDK is silent until a route, handler, or function is wrapped with `observe()` or a framework adapter's explicit decorator/middleware.

## Product doctrine

- The primary record is an information-dense operation occurrence, not a log, span, or metric.
- Automatic database and outbound HTTP detail exists only within an active operation.
- Business context, semantic events, meaningful steps, and usage are explicit.
- Usage is an idempotent, durable ledger intended for export, not a billing engine.
- One opinionated dashboard answers known questions. There is no dashboard builder or query language.
- One process, one port, one SQLite file, and one Docker container are the default deployment.
- Supported runtime ecosystem: Node.js/TypeScript, Express, NestJS, tsoa-on-Express, Next.js server route handlers, Prisma, and native fetch.

## Public developer API

Developers learn `observe()`, `observe.set()`, `observe.event()`, `observe.meter()`, and `observe.step()`. Adapters make the first call idiomatic for each framework. Calls to context APIs outside an active occurrence are safe no-ops.

## Guardrails

Context/event attributes accept at most 32 entries; keys are at most 64 characters; string values at most 512 characters. Event and step names are at most 128 characters. Bodies, headers, cookies, SQL text, and bind parameters are never captured. URL paths are normalized to reduce identifiers and cardinality.

## Retention defaults

- successful raw occurrences: 7 days
- error occurrences: 30 days
- hourly aggregates and service health: 365 days
- usage meter ledger: indefinite

All raw/aggregate retention windows are configurable with environment variables.
