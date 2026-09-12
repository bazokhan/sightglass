import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../apps/server/src/database.js";
import type { IngestEnvelope, Occurrence, UsageEvent } from "../packages/core/src/types.js";

type Statistics = { samples: number[]; min: number; median: number; mean: number; p95: number; max: number; standardDeviation: number; coefficientOfVariation: number };
type ThroughputResult = { id: string; label: string; unit: "occurrences/s" | "meters/s"; countPerIteration: number; statistics: Statistics };
type LatencyResult = { id: string; label: string; unit: "ms"; statistics: Statistics };

const settings = {
  occurrences: positiveInteger("SIGHTGLASS_BENCHMARK_COUNT", 10_000),
  queryDataset: positiveInteger("SIGHTGLASS_BENCHMARK_QUERY_COUNT", 25_000),
  iterations: positiveInteger("SIGHTGLASS_BENCHMARK_ITERATIONS", 5),
  queryIterations: positiveInteger("SIGHTGLASS_BENCHMARK_QUERY_ITERATIONS", 30),
  warmupCount: positiveInteger("SIGHTGLASS_BENCHMARK_WARMUP_COUNT", 500),
  batchSize: 100,
};
const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "sightglass-benchmark-"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

try {
  console.log(`Sightglass benchmark suite: ${settings.iterations} iterations, ${settings.occurrences.toLocaleString()} records each`);
  warmup();
  const throughput: ThroughputResult[] = [];
  throughput.push(runStoreThroughput("memory-ingest", "In-memory SQLite", ":memory:", "occurrences/s"));
  throughput.push(runStoreThroughput("wal-ingest", "SQLite WAL on disk", "disk", "occurrences/s"));
  throughput.push(runMeterThroughput());
  throughput.push(await runHttpThroughput());
  const query = runQueryLatency();
  const storage = measureStorage();
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: { name: "Sightglass", version: packageJson.version },
    methodology: {
      deterministicFixture: true,
      warmupExcluded: true,
      sequentialRequests: true,
      validationIncludedInHttp: true,
      samplesReported: "raw, min, median, mean, p95, max, standard deviation, coefficient of variation",
      settings,
    },
    environment: {
      node: process.version,
      platform: platform(),
      osRelease: release(),
      architecture: process.arch,
      cpu: cpus()[0]?.model.trim() ?? "unknown",
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    throughput,
    queryLatency: query,
    storage,
  };

  const outputDir = resolve(process.env.SIGHTGLASS_BENCHMARK_OUTPUT_DIR ?? join(root, ".benchmark-output"));
  const resultsDir = outputDir;
  const assetsDir = outputDir;
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(resultsDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(resultsDir, "latest.md"), latestMarkdown(result));
  writeFileSync(join(assetsDir, "throughput.svg"), throughputChart(throughput));
  writeFileSync(join(assetsDir, "query-latency.svg"), latencyChart(query));
  console.log(JSON.stringify({ throughput: throughput.map((item) => ({ id: item.id, median: item.statistics.median, p95: item.statistics.p95, unit: item.unit })), queryP95Ms: Object.fromEntries(query.map((item) => [item.id, item.statistics.p95])), storage }, null, 2));
  console.log(`Wrote benchmark evidence to ${outputDir}. Set SIGHTGLASS_BENCHMARK_OUTPUT_DIR to the documentation repository's public/benchmarks directory when refreshing published evidence.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

function warmup(): void {
  const store = new Store(":memory:");
  ingestRange(store, settings.warmupCount, 9_000_000);
  for (let offset = 0; offset < settings.warmupCount; offset += settings.batchSize) {
    const size = Math.min(settings.batchSize, settings.warmupCount - offset);
    store.ingest({ protocol: 1, occurrences: [], meters: Array.from({ length: size }, (_, index) => sampleMeter(9_500_000 + offset + index)), health: [] });
  }
  store.summary("2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
  store.database.close();
}

function runStoreThroughput(id: string, label: string, database: ":memory:" | "disk", unit: "occurrences/s"): ThroughputResult {
  const samples: number[] = [];
  for (let iteration = 0; iteration < settings.iterations; iteration++) {
    const path = database === "disk" ? join(work, `${id}-${iteration}.db`) : ":memory:";
    const store = new Store(path);
    const started = performance.now();
    ingestRange(store, settings.occurrences, iteration * settings.occurrences);
    const elapsed = performance.now() - started;
    store.database.close();
    samples.push(settings.occurrences / (elapsed / 1_000));
  }
  return { id, label, unit, countPerIteration: settings.occurrences, statistics: statistics(samples) };
}

function runMeterThroughput(): ThroughputResult {
  const samples: number[] = [];
  for (let iteration = 0; iteration < settings.iterations; iteration++) {
    const store = new Store(join(work, `meters-${iteration}.db`));
    const started = performance.now();
    for (let offset = 0; offset < settings.occurrences; offset += settings.batchSize) {
      const size = Math.min(settings.batchSize, settings.occurrences - offset);
      const meters = Array.from({ length: size }, (_, index) => sampleMeter(iteration * settings.occurrences + offset + index));
      store.ingest({ protocol: 1, occurrences: [], meters, health: [] });
    }
    const elapsed = performance.now() - started;
    store.database.close();
    samples.push(settings.occurrences / (elapsed / 1_000));
  }
  return { id: "meter-ledger", label: "Exact meter ledger", unit: "meters/s", countPerIteration: settings.occurrences, statistics: statistics(samples) };
}

async function runHttpThroughput(): Promise<ThroughputResult> {
  const samples: number[] = [];
  for (let iteration = 0; iteration < settings.iterations; iteration++) {
    const port = await availablePort();
    const databasePath = join(work, `http-${iteration}.db`);
    const child = spawn(process.execPath, [join(root, "apps", "server", "dist", "index.js")], {
      cwd: root,
      env: { ...process.env, SIGHTGLASS_PORT: String(port), SIGHTGLASS_DATABASE_PATH: databasePath, SIGHTGLASS_DASHBOARD_PATH: join(work, "no-dashboard"), SIGHTGLASS_SUCCESS_RETENTION_DAYS: "3650", SIGHTGLASS_ERROR_RETENTION_DAYS: "3650" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForServer(child, port);
      for (let offset = 0; offset < settings.warmupCount; offset += settings.batchSize) {
        const size = Math.min(settings.batchSize, settings.warmupCount - offset);
        const envelope: IngestEnvelope = { protocol: 1, occurrences: Array.from({ length: size }, (_, index) => sampleOccurrence(9_700_000 + offset + index)), meters: [], health: [] };
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
        if (response.status !== 202) throw new Error(`HTTP warmup failed: ${response.status}`);
      }
      const started = performance.now();
      for (let offset = 0; offset < settings.occurrences; offset += settings.batchSize) {
        const size = Math.min(settings.batchSize, settings.occurrences - offset);
        const base = iteration * settings.occurrences + offset;
        const envelope: IngestEnvelope = { protocol: 1, occurrences: Array.from({ length: size }, (_, index) => sampleOccurrence(base + index)), meters: [], health: [] };
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
        if (response.status !== 202) throw new Error(`HTTP benchmark ingest failed: ${response.status} ${await response.text()}`);
      }
      const elapsed = performance.now() - started;
      samples.push(settings.occurrences / (elapsed / 1_000));
    } finally {
      await stopChild(child);
    }
  }
  return { id: "http-ingest", label: "HTTP + validation + WAL", unit: "occurrences/s", countPerIteration: settings.occurrences, statistics: statistics(samples) };
}

function runQueryLatency(): LatencyResult[] {
  const store = new Store(join(work, "queries.db"));
  ingestRange(store, settings.queryDataset, 7_000_000, true);
  const from = "2026-01-01T00:00:00.000Z";
  const to = "2027-01-01T00:00:00.000Z";
  const occurrenceId = sampleOccurrence(7_000_000).id;
  const cases: Array<[string, string, () => unknown]> = [
    ["summary", "Overview summary", () => store.summary(from, to)],
    ["occurrence-list", "Occurrence list (50)", () => store.occurrences({ from, to, limit: 50, offset: 0 })],
    ["occurrence-detail", "Occurrence detail", () => store.occurrence(occurrenceId)],
    ["database-ranking", "Database ranking", () => store.databaseRanking(from, to)],
    ["dependency-ranking", "Dependency ranking", () => store.dependencyRanking(from, to)],
    ["usage-totals", "Usage totals", () => store.usage(from, to)],
  ];
  const results = cases.map(([id, label, run]) => {
    for (let index = 0; index < 5; index++) run();
    const samples = Array.from({ length: settings.queryIterations }, () => measure(run));
    return { id, label, unit: "ms" as const, statistics: statistics(samples) };
  });
  store.database.close();
  return results;
}

function measureStorage(): { records: number; databaseBytes: number; bytesPerRichOccurrence: number; jsonPayloadBytesPerOccurrence: number } {
  const path = join(work, "storage.db");
  const store = new Store(path);
  ingestRange(store, settings.occurrences, 8_000_000, true);
  store.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  store.database.close();
  const databaseBytes = statSync(path).size;
  const payload = JSON.stringify({ protocol: 1, occurrences: [sampleOccurrence(1)], meters: [sampleMeter(1)], health: [] });
  return { records: settings.occurrences, databaseBytes, bytesPerRichOccurrence: round(databaseBytes / settings.occurrences, 2), jsonPayloadBytesPerOccurrence: Buffer.byteLength(payload) };
}

function ingestRange(store: Store, count: number, base: number, includeMeters = false): void {
  for (let offset = 0; offset < count; offset += settings.batchSize) {
    const size = Math.min(settings.batchSize, count - offset);
    const occurrences = Array.from({ length: size }, (_, index) => sampleOccurrence(base + offset + index));
    const meters = includeMeters ? Array.from({ length: size }, (_, index) => sampleMeter(base + offset + index)) : [];
    store.ingest({ protocol: 1, occurrences, meters, health: [] });
  }
}

function sampleOccurrence(index: number): Occurrence {
  const id = uuid(index * 7 + 1);
  const traceId = hex(index * 11 + 3, 32);
  return {
    id,
    operation: `operation.${index % 20}`,
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 86_400)).toISOString(),
    durationMs: 10 + index % 200,
    status: index % 50 ? "success" : "error",
    service: `service-${index % 4}`,
    environment: "benchmark",
    request: { method: index % 3 ? "POST" : "GET", route: `/records/:id`, statusCode: index % 50 ? 200 : 500 },
    context: { tenantId: `tenant-${index % 100}`, plan: index % 3 ? "pro" : "free", region: `region-${index % 4}` },
    database: { queryCount: 1, totalDurationMs: 4, operations: [{ id: uuid(index * 7 + 2), model: "Record", action: "findMany", atMs: 1, durationMs: 4, status: "success" }] },
    dependencies: [{ id: uuid(index * 7 + 3), host: "api.example", method: "GET", path: "/records/:id", atMs: 5, durationMs: 3, status: "success", statusCode: 200 }],
    events: [{ id: uuid(index * 7 + 4), name: "record.selected", atMs: 7, attributes: { source: "benchmark" } }],
    steps: [{ id: uuid(index * 7 + 5), name: "authorize", atMs: 0, durationMs: 2, status: "success" }],
    usage: [uuid(index * 7 + 6)],
    runtime: { pid: 1, uptimeSeconds: 3600, memoryRssBytes: 134_217_728, memoryHeapUsedBytes: 67_108_864 },
    distributed: { traceId, spanId: hex(index * 13 + 5, 16) },
  };
}

function sampleMeter(index: number): UsageEvent {
  return { id: uuid(index * 7 + 6), occurrenceId: uuid(index * 7 + 1), timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 86_400)).toISOString(), service: `service-${index % 4}`, environment: "benchmark", meter: "ai.tokens", quantity: 100 + index % 900, unit: "tokens", tenantId: `tenant-${index % 100}`, attributes: { model: "benchmark-model" } };
}

function statistics(values: number[]): Statistics {
  const samples = values.map((value) => round(value, 3));
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  const standardDeviation = Math.sqrt(variance);
  return { samples, min: round(sorted[0] ?? 0, 3), median: round(percentile(sorted, 0.5), 3), mean: round(mean, 3), p95: round(percentile(sorted, 0.95), 3), max: round(sorted.at(-1) ?? 0, 3), standardDeviation: round(standardDeviation, 3), coefficientOfVariation: round(mean ? standardDeviation / mean : 0, 4) };
}

function percentile(sorted: number[], value: number): number { return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0; }
function measure(run: () => unknown): number { const started = performance.now(); run(); return performance.now() - started; }
function round(value: number, places = 1): number { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function positiveInteger(name: string, fallback: number): number { const value = Number(process.env[name] ?? fallback); if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); return value; }
function hex(value: number, length: number): string { const base = Math.abs(value).toString(16); return base.padStart(length, "0").slice(-length); }
function uuid(value: number): string { const valueHex = hex(value, 32); return `${valueHex.slice(0, 8)}-${valueHex.slice(8, 12)}-${valueHex.slice(12, 16)}-${valueHex.slice(16, 20)}-${valueHex.slice(20)}`; }

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolvePromise()); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return port;
}

async function waitForServer(child: ChildProcess, port: number): Promise<void> {
  let diagnostic = "";
  child.stderr?.on("data", (chunk: Buffer) => { diagnostic += chunk.toString(); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Benchmark server exited early: ${diagnostic}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`); if (response.ok) return; } catch { /* startup */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Benchmark server did not become ready: ${diagnostic}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())), new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function throughputChart(items: ThroughputResult[]): string {
  const width = 920; const height = 390; const left = 245; const top = 54; const row = 70; const plot = 620;
  const max = Math.max(...items.map((item) => item.statistics.max)) * 1.08;
  const bars = items.map((item, index) => { const y = top + index * row; const median = item.statistics.median / max * plot; const p95 = item.statistics.p95 / max * plot; return `<text x="${left - 14}" y="${y + 22}" text-anchor="end" class="label">${escapeXml(item.label)}</text><rect x="${left}" y="${y}" width="${median}" height="34" rx="5" class="bar"/><line x1="${left + median}" y1="${y - 4}" x2="${left + median}" y2="${y + 39}" class="median"/><circle cx="${left + p95}" cy="${y + 17}" r="5" class="p95"/><text x="${left + median + 9}" y="${y + 22}" class="value">${Math.round(item.statistics.median).toLocaleString()} ${item.unit}</text>`; }).join("");
  return svgFrame(width, height, "Measured ingestion throughput", "Median bar; dot is the fastest (p95) repeated sample", bars);
}

function latencyChart(items: LatencyResult[]): string {
  const width = 920; const height = 500; const left = 245; const top = 54; const row = 62; const plot = 620;
  const max = Math.max(...items.map((item) => item.statistics.p95)) * 1.12 || 1;
  const bars = items.map((item, index) => { const y = top + index * row; const median = item.statistics.median / max * plot; const p95 = item.statistics.p95 / max * plot; return `<text x="${left - 14}" y="${y + 20}" text-anchor="end" class="label">${escapeXml(item.label)}</text><rect x="${left}" y="${y}" width="${p95}" height="31" rx="5" class="tail"/><rect x="${left}" y="${y}" width="${median}" height="31" rx="5" class="bar"/><text x="${left + p95 + 9}" y="${y + 20}" class="value">${item.statistics.median.toFixed(2)} / ${item.statistics.p95.toFixed(2)} ms</text>`; }).join("");
  return svgFrame(width, height, "Dashboard query latency", "Median (amber) and p95 (blue), lower is better", bars);
}

function svgFrame(width: number, height: number, title: string, subtitle: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(subtitle)}</desc><style>text{font-family:system-ui,sans-serif}.title{fill:#f2eee8;font-size:20px;font-weight:700}.subtitle,.label,.value{fill:#9ea2ab;font-size:12px}.label{fill:#d7d8dc}.value{font-family:ui-monospace,monospace}.bar{fill:#e7a348}.tail{fill:#31547b}.median{stroke:#fff2dc;stroke-width:2}.p95{fill:#71b7ff}</style><rect width="100%" height="100%" rx="12" fill="#15171c"/><text x="28" y="30" class="title">${escapeXml(title)}</text><text x="28" y="48" class="subtitle">${escapeXml(subtitle)}</text>${body}</svg>\n`;
}

function latestMarkdown(result: { generatedAt: string; environment: { node: string; platform: string; osRelease: string; architecture: string; cpu: string; logicalCpus: number; totalMemoryBytes: number }; methodology: { settings: { occurrences: number; iterations: number; queryDataset: number; queryIterations: number; warmupCount: number; batchSize: number } }; throughput: ThroughputResult[]; queryLatency: LatencyResult[]; storage: { records: number; databaseBytes: number; bytesPerRichOccurrence: number; jsonPayloadBytesPerOccurrence: number } }): string {
  const throughputRows = result.throughput.map((item) => `| ${item.label} | ${Math.round(item.statistics.median).toLocaleString("en-US")} ${item.unit} | ${Math.round(item.statistics.p95).toLocaleString("en-US")} ${item.unit} | ${(item.statistics.coefficientOfVariation * 100).toFixed(1)}% |`).join("\n");
  const latencyRows = result.queryLatency.map((item) => `| ${item.label} | ${item.statistics.median.toFixed(3)} ms | ${item.statistics.p95.toFixed(3)} ms |`).join("\n");
  return `# Latest benchmark result\n\nGenerated ${result.generatedAt} by \`npm run benchmark\`.\n\n## Environment\n\n| Runtime | OS | CPU | Logical CPUs | Memory |\n| --- | --- | --- | ---: | ---: |\n| ${result.environment.node} | ${result.environment.platform} ${result.environment.osRelease} ${result.environment.architecture} | ${result.environment.cpu} | ${result.environment.logicalCpus} | ${(result.environment.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB |\n\n## Throughput\n\n| Path | Median | p95 sample | CV |\n| --- | ---: | ---: | ---: |\n${throughputRows}\n\n![Measured ingestion throughput](throughput.svg)\n\n## Query latency\n\n| Dashboard query | Median | p95 |\n| --- | ---: | ---: |\n${latencyRows}\n\n![Dashboard query latency](query-latency.svg)\n\n## Storage\n\n| Records | Database after checkpoint | Bytes / rich occurrence | JSON bytes / operation + meter |\n| ---: | ---: | ---: | ---: |\n| ${result.storage.records.toLocaleString("en-US")} | ${result.storage.databaseBytes.toLocaleString("en-US")} B | ${result.storage.bytesPerRichOccurrence.toLocaleString("en-US")} B | ${result.storage.jsonPayloadBytesPerOccurrence.toLocaleString("en-US")} B |\n\n## Settings\n\n\`\`\`json\n${JSON.stringify(result.methodology.settings, null, 2)}\n\`\`\`\n\nRaw samples and full descriptive statistics: [latest.json](latest.json).\n`;
}
function escapeXml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
