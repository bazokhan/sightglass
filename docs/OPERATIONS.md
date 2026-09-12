# Operating Sightglass

## Security boundary

Sightglass contains business context and usage records. `SIGHTGLASS_API_KEY` protects ingestion only; it is not dashboard authentication. Expose port 7777 only on a trusted private network, or put Sightglass behind a reverse proxy that authenticates all read and dashboard requests. Use TLS at that boundary.

## Persistence, backup, and restore

The container stores `/data/sightglass.db` in the `sightglass-data` volume. SQLite runs in WAL mode. For a consistent online backup, use SQLite's backup command against the mounted database; alternatively stop the container before copying the database file and its `-wal`/`-shm` companions. Restore while Sightglass is stopped, then start the same or newer image. Never copy only the main file while the process is writing.

Run `npm run verify:recovery` from a source checkout to exercise the supported online-backup path against a populated database, restore into a clean file, and verify raw telemetry, aggregates, exact meters, health history, and schema migrations.

## Upgrades

Back up the volume, pull/build the new image, and recreate the container with the same volume. Ordered migrations run transactionally at startup and are recorded in `schema_migrations`. Do not downgrade an upgraded database without restoring its matching backup.

## Retention

Successful occurrences default to 7 days, errors to 30 days, and ordinary hourly/health aggregates to 365 days. Configure those three windows with the documented environment variables. Exact meter rows and their compact hourly totals are retained indefinitely so historical usage remains queryable and exportable.

## Meter recovery

By default the SDK synchronously writes each meter to `.sightglass-spool` before returning its ID. Delivery reads the disk backlog through a bounded in-memory window and removes files only after HTTP 202. Mount the spool on durable storage, monitor its size, and keep it unique per application process. Setting `meterSpoolDirectory: false` opts out of crash durability.

Use `onTelemetryError(error, area)` to surface spool or transport failures to the application's existing logger/alerting system. The callback is diagnostic and exceptions from it are isolated from application work.

## Application shutdown

Stop accepting new application work, then call `await shutdownSightglass()` before exiting. Shutdown is idempotent and attempts to drain pending occurrences, meters, and health samples. Durable meters remain on the spool if the server is unavailable; ordinary occurrences are intentionally best-effort. NestJS and the Fastify plugin connect this drain to their framework shutdown lifecycle.

## Capacity

Run `npm run benchmark` as a regression check, then load-test using the production filesystem and container limits. See [BENCHMARKS.md](BENCHMARKS.md).
