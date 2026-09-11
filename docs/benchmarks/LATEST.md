# Latest benchmark result

Generated 2026-09-11T21:55:13.020Z by `npm run benchmark`. This file, the JSON, dashboard data, and SVG charts are generated together.

## Environment

| Runtime | OS | CPU | Logical CPUs | Memory |
| --- | --- | --- | ---: | ---: |
| v24.18.0 | win32 10.0.26200 x64 | Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz | 8 | 15.8 GiB |

## Throughput

| Path | Median | p95 sample | CV |
| --- | ---: | ---: | ---: |
| In-memory SQLite | 2,713 occurrences/s | 2,833 occurrences/s | 9.5% |
| SQLite WAL on disk | 2,301 occurrences/s | 2,437 occurrences/s | 16.2% |
| Exact meter ledger | 8,867 meters/s | 10,357 meters/s | 25.8% |
| HTTP + validation + WAL | 1,586 occurrences/s | 1,758 occurrences/s | 28.9% |

![Measured ingestion throughput](../assets/benchmarks/throughput.svg)

## Query latency

| Dashboard query | Median | p95 |
| --- | ---: | ---: |
| Overview summary | 5.813 ms | 11.523 ms |
| Occurrence list (50) | 0.360 ms | 0.502 ms |
| Occurrence detail | 0.061 ms | 0.232 ms |
| Database ranking | 0.224 ms | 0.266 ms |
| Dependency ranking | 0.236 ms | 0.315 ms |
| Usage totals | 0.965 ms | 1.541 ms |

![Dashboard query latency](../assets/benchmarks/query-latency.svg)

## Storage

| Records | Database after checkpoint | Bytes / rich occurrence | JSON bytes / operation + meter |
| ---: | ---: | ---: | ---: |
| 10,000 | 33,460,224 B | 3,346.02 B | 1,535 B |

## Settings

```json
{
  "occurrences": 10000,
  "queryDataset": 25000,
  "iterations": 5,
  "queryIterations": 30,
  "warmupCount": 500,
  "batchSize": 100
}
```

Raw samples and full descriptive statistics: [latest.json](latest.json). Methodology and interpretation limits: [BENCHMARKS.md](../BENCHMARKS.md).
