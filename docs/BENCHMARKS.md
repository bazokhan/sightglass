# Reproducible benchmarks

Sightglass ships a deterministic benchmark suite that exercises the real persistence and HTTP paths. The checked-in report is evidence for a specific commit and machine—not a universal capacity promise.

## Latest result

Measured 12 September 2026 on Node.js 24.18.0, Windows x64, an Intel Core i5-10300H (8 logical CPUs), and 16 GB RAM. Each throughput scenario uses five independent 10,000-record databases after an excluded warmup. Query results use 30 measured samples after five excluded warm-cache calls over 25,000 rich occurrences.

| Path | Median | p95 sample | Variation (CV) |
| --- | ---: | ---: | ---: |
| In-memory SQLite ingest | 2,713 occurrences/s | 2,833 occurrences/s | 9.5% |
| SQLite WAL ingest | 2,301 occurrences/s | 2,437 occurrences/s | 16.2% |
| Exact meter ledger | 8,867 meters/s | 10,357 meters/s | 25.8% |
| HTTP + JSON + validation + WAL | 1,586 occurrences/s | 1,758 occurrences/s | 28.9% |

![Sightglass ingestion throughput](assets/benchmarks/throughput.svg)

| Dashboard query over 25,000 operations | Median | p95 |
| --- | ---: | ---: |
| Overview summary | 5.81 ms | 11.52 ms |
| Occurrence list (50) | 0.36 ms | 0.50 ms |
| Occurrence detail | 0.06 ms | 0.23 ms |
| Database ranking | 0.22 ms | 0.27 ms |
| Dependency ranking | 0.24 ms | 0.32 ms |
| Usage totals | 0.97 ms | 1.54 ms |

![Sightglass dashboard query latency](assets/benchmarks/query-latency.svg)

The 10,000-operation disk fixture occupied 33,460,224 bytes after a WAL checkpoint: 3,346 bytes per rich occurrence. The representative JSON operation plus its meter was 1,535 bytes before HTTP compression.

The authoritative [generated result](benchmarks/LATEST.md) and [machine-readable output](benchmarks/latest.json) include every raw sample, min, median, mean, p95, max, standard deviation, coefficient of variation, settings, and environment. Generated graphs are SVG so they remain reviewable without proprietary chart tooling.

## What is measured

- **In-memory ingest:** database insertion, indexes, hourly operation aggregate, database aggregate, and dependency aggregate without filesystem durability.
- **WAL ingest:** the same rich occurrence on a temporary on-disk SQLite database using the production schema and WAL mode.
- **Exact meter ledger:** idempotent usage-row insertion plus compact meter-total maintenance on WAL storage.
- **HTTP ingest:** the built server on loopback, including client serialization, HTTP routing, JSON parsing, schema validation, and WAL persistence. It intentionally excludes real network latency.
- **Dashboard reads:** the exact `Store` queries used by Overview, Operations, Database, Dependencies, and Usage.
- **Storage density:** database bytes after `wal_checkpoint(TRUNCATE)`, divided by stored rich occurrences.

Every rich occurrence includes bounded business context, request metadata, one semantic event, one step, one Prisma-style database operation, one outbound dependency, runtime context, and distributed trace identifiers. Fixture timestamps and identifiers are deterministic.

## Reproduce

```bash
npm ci
npm run benchmark
```

The command builds the server first, uses isolated operating-system temporary directories, excludes warmups, starts a fresh real HTTP server and database per HTTP iteration, fails on non-202 ingestion, and regenerates:

- `docs/benchmarks/latest.json`
- `docs/benchmarks/LATEST.md`
- `docs/assets/benchmarks/throughput.svg`
- `docs/assets/benchmarks/query-latency.svg`
- `apps/dashboard/src/benchmark-results.ts`

Control the workload without editing code:

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `SIGHTGLASS_BENCHMARK_COUNT` | 10,000 | Records per throughput iteration |
| `SIGHTGLASS_BENCHMARK_ITERATIONS` | 5 | Independent throughput samples |
| `SIGHTGLASS_BENCHMARK_QUERY_COUNT` | 25,000 | Seeded records for query tests |
| `SIGHTGLASS_BENCHMARK_QUERY_ITERATIONS` | 30 | Measured samples per query |
| `SIGHTGLASS_BENCHMARK_WARMUP_COUNT` | 500 | Excluded warmup records |

For release comparisons, use the same machine, power mode, Node.js version, filesystem, settings, and background workload. Run at least twice, retain raw JSON from both runs, and investigate a coefficient of variation above 15%. Several current write-path samples exceed that threshold on this shared developer machine, so their medians are useful regression baselines but should not be presented as capacity guarantees.

## Limitations

- Loopback HTTP does not model network latency, TLS termination, proxies, or multiple concurrent clients.
- The suite uses one sequential producer because Sightglass targets a lightweight single-server deployment; it does not claim fleet-scale saturation capacity.
- Antivirus, thermal state, power management, available RAM, and filesystem caching can affect local results.
- Query measurements are warm-cache and do not represent first access after a cold restart.
- Competitor performance is deliberately not benchmarked: a fair cross-product study requires equivalent retention, sampling, payloads, hardware, and tuning.
