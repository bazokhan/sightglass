# Performance checks

Sightglass includes a repeatable local ingestion benchmark:

```bash
npm run benchmark
```

It inserts 10,000 representative occurrences into an in-memory SQLite database in 100-item transactions. Every occurrence includes a database call and a dependency call, so raw indexes and all three aggregate paths are exercised. The command reports ingest time, occurrences per second, and a 20-operation aggregate summary latency. Set `SIGHTGLASS_BENCHMARK_COUNT` to change the sample size.

This is a regression signal, not a universal capacity promise: disk durability, CPU, Node.js, container limits, and payload shape all materially affect production throughput. Capacity-test with the same filesystem and limits used in deployment.
