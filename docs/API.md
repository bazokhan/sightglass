# HTTP API

All timestamps are ISO 8601. Range endpoints accept optional `from` and `to`; the default is the last 24 hours. JSON endpoints return HTTP 200 unless noted.

## Ingestion

`POST /api/v1/ingest` accepts protocol v1 envelopes documented in [PROTOCOL.md](PROTOCOL.md). It returns HTTP 202 with accepted item counts. When `SIGHTGLASS_API_KEY` is configured, send `Authorization: Bearer <key>`.

## Dashboard and export endpoints

- `GET /healthz` — process readiness.
- `GET /api/v1/services` — observed service/environment combinations and last-seen timestamps.
- `GET /api/v1/summary?from=&to=&service=&environment=` — calls, errors, unauthorized counts, latency percentiles, and DB share by operation.
- `GET /api/v1/trend?from=&to=&service=&environment=` — hourly calls, errors, error rate, average latency, and p95 latency.
- `GET /api/v1/occurrences?from=&to=&service=&environment=&operation=&status=&limit=&offset=` — raw occurrence list. `limit` is capped at 200.
- `GET /api/v1/occurrences/:id` — full occurrence, local timeline data, and correlated distributed occurrences.
- `GET /api/v1/traces/:traceId` — ordered occurrences in one distributed operation.
- `GET /api/v1/database?from=&to=&service=&environment=` — aggregate Prisma rankings including their source operations.
- `GET /api/v1/dependencies?from=&to=&service=&environment=` — aggregate outbound dependency rankings including source operations.
- `GET /api/v1/usage?from=&to=&service=&environment=&tenantId=` — exact aggregate meter totals.
- `GET /api/v1/usage/trend?from=&to=&service=&environment=` — hourly exact meter quantity and event totals.
- `GET /api/v1/usage/export?from=&to=&service=&environment=&format=json` — exact raw ledger export. Omit `format=json` for CSV.
- `GET /api/v1/health?from=&to=&service=&environment=` — process/host samples and restart count within the range.

The `service` and `environment` filters have identical meaning across every range endpoint and the dashboard applies them globally.

Read endpoints are intentionally not authenticated by Sightglass itself. Keep the service private or use an authenticating reverse proxy.
