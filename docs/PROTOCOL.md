# Ingestion protocol v1

SDKs send `POST /api/v1/ingest` with JSON and `Content-Type: application/json`.

```json
{ "protocol": 1, "occurrences": [], "meters": [], "health": [] }
```

The body limit is 1 MiB. A batch accepts at most 100 occurrences, 500 meter events, and 100 health samples. Invalid envelopes are rejected atomically with HTTP 400. When `SIGHTGLASS_API_KEY` is set, ingestion requires `Authorization: Bearer <key>`.

HTTP 202 acknowledges persistence. Occurrence and meter IDs are idempotency keys; duplicate IDs are successful no-ops. Clients may retry safely. Ordinary occurrences use a bounded in-memory queue. Meter events are synchronously spooled to individual local files when `observe.meter()` is called, paged through bounded memory, and deleted only after acknowledgement. Failed delivery uses capped exponential backoff with jitter. Applications can route transport and spool failures through `onTelemetryError` without making telemetry failure fatal to host work.

Distributed correlation uses W3C `traceparent` version `00`. A downstream service records a child only if its route is explicitly observed.
