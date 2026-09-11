import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HealthSample, IngestEnvelope, Occurrence, UsageEvent } from "@sightglass/core";

type Row = Record<string, unknown>;

export class Store {
  readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
    this.database.exec("PRAGMA optimize");
  }

  ingest(envelope: IngestEnvelope): { occurrences: number; meters: number; health: number } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const occurrence of envelope.occurrences) this.insertOccurrence(occurrence);
      for (const meter of envelope.meters) this.insertMeter(meter);
      for (const sample of envelope.health) this.insertHealth(sample);
      this.database.exec("COMMIT");
      return { occurrences: envelope.occurrences.length, meters: envelope.meters.length, health: envelope.health.length };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  summary(from: string, to: string, service?: string): object {
    const where = service ? "hour >= ? AND hour <= ? AND service = ?" : "hour >= ? AND hour <= ?";
    const params = service ? [hour(from), hour(to), service] : [hour(from), hour(to)];
    const rows = this.database.prepare(`SELECT operation, service, SUM(call_count) calls, SUM(error_count) errors, SUM(unauthorized_count) unauthorized, SUM(duration_sum) duration_sum, SUM(db_duration_sum) db_duration_sum, GROUP_CONCAT(latencies_json, '|') latency_groups FROM hourly_aggregates WHERE ${where} GROUP BY operation, service ORDER BY calls DESC`).all(...params) as Row[];
    return rows.map((row) => {
      const latencies = String(row.latency_groups ?? "").split("|").flatMap((group) => safeNumbers(group));
      return { operation: row.operation, service: row.service, calls: row.calls, errors: row.errors, unauthorized: row.unauthorized, errorRate: percent(Number(row.errors), Number(row.calls)), averageMs: ratio(Number(row.duration_sum), Number(row.calls)), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), dbShare: percent(Number(row.db_duration_sum), Number(row.duration_sum)) };
    });
  }

  occurrences(filters: { from: string; to: string; service?: string; operation?: string; status?: string; limit: number; offset: number }): object[] {
    const clauses = ["started_at >= ?", "started_at <= ?"];
    const params: Array<string | number> = [filters.from, filters.to];
    for (const [column, value] of [["service", filters.service], ["operation", filters.operation], ["status", filters.status]] as const) if (value) { clauses.push(`${column} = ?`); params.push(value); }
    params.push(filters.limit, filters.offset);
    return (this.database.prepare(`SELECT id, operation, started_at startedAt, duration_ms durationMs, status, service, environment, trace_id traceId, parent_id parentId, context_json context, error_json error FROM occurrences WHERE ${clauses.join(" AND ")} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...params) as Row[]).map(hydrateListRow);
  }

  occurrence(id: string): object | undefined {
    const row = this.database.prepare("SELECT payload_json payload FROM occurrences WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    const occurrence = JSON.parse(String(row.payload)) as Occurrence;
    return { ...occurrence, distributedOccurrences: this.trace(occurrence.distributed.traceId) };
  }

  trace(traceId: string): object[] {
    return (this.database.prepare("SELECT payload_json payload FROM occurrences WHERE trace_id = ? ORDER BY started_at").all(traceId) as Row[])
      .map((row) => JSON.parse(String(row.payload)) as object);
  }

  databaseRanking(from: string, to: string): object[] {
    return this.database.prepare("SELECT source_operation sourceOperation, model || '.' || action operation, SUM(call_count) calls, ROUND(SUM(duration_sum), 2) totalMs, ROUND(SUM(duration_sum) / SUM(call_count), 2) averageMs, ROUND(MAX(duration_max), 2) slowestMs FROM hourly_database_aggregates WHERE hour >= ? AND hour <= ? GROUP BY source_operation, model, action ORDER BY totalMs DESC LIMIT 50").all(hour(from), hour(to)) as object[];
  }

  dependencyRanking(from: string, to: string): object[] {
    return this.database.prepare("SELECT source_operation sourceOperation, host, method, path, SUM(call_count) calls, SUM(error_count) errors, ROUND(SUM(duration_sum) / SUM(call_count), 2) averageMs, ROUND(MAX(duration_max), 2) slowestMs FROM hourly_dependency_aggregates WHERE hour >= ? AND hour <= ? GROUP BY source_operation, host, method, path ORDER BY calls DESC LIMIT 50").all(hour(from), hour(to)) as object[];
  }

  usage(from: string, to: string, tenantId?: string): object[] {
    const tenant = tenantId ? "AND tenant_id = ?" : "";
    const params = tenantId ? [hour(from), hour(to), tenantId] : [hour(from), hour(to)];
    return this.database.prepare(`SELECT meter, NULLIF(unit, '') unit, service, NULLIF(tenant_id, '') tenantId, SUM(quantity_sum) quantity, SUM(event_count) events FROM hourly_meter_aggregates WHERE hour >= ? AND hour <= ? ${tenant} GROUP BY meter, unit, service, tenant_id ORDER BY quantity DESC`).all(...params) as object[];
  }

  usageRows(from: string, to: string): Row[] {
    return this.database.prepare("SELECT id, timestamp, service, environment, tenant_id tenantId, meter, unit, quantity, occurrence_id occurrenceId, attributes_json attributes FROM meters WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp").all(from, to) as Row[];
  }

  health(from: string, to: string): object[] {
    return this.database.prepare("SELECT service, environment, timestamp, cpu_percent cpuPercent, memory_rss_bytes memoryRssBytes, heap_used_bytes memoryHeapUsedBytes, event_loop_lag_ms eventLoopLagMs, uptime_seconds uptimeSeconds, pid, host_memory_total_bytes hostMemoryTotalBytes, host_memory_free_bytes hostMemoryFreeBytes, host_load_1m hostLoad1m, disk_total_bytes diskTotalBytes, disk_free_bytes diskFreeBytes, restart_detected restartDetected FROM health_samples WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp").all(from, to) as object[];
  }

  services(): object[] { return this.database.prepare("SELECT service, MAX(started_at) lastSeen FROM occurrences GROUP BY service ORDER BY service").all() as object[]; }

  cleanup(successDays: number, errorDays: number, aggregateDays: number): void {
    const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM occurrences WHERE status = 'success' AND started_at < ?").run(cutoff(successDays));
      this.database.prepare("DELETE FROM occurrences WHERE status = 'error' AND started_at < ?").run(cutoff(errorDays));
      this.database.prepare("DELETE FROM hourly_aggregates WHERE hour < ?").run(cutoff(aggregateDays));
      this.database.prepare("DELETE FROM hourly_meter_aggregates WHERE hour < ?").run(cutoff(aggregateDays));
      this.database.prepare("DELETE FROM hourly_database_aggregates WHERE hour < ?").run(cutoff(aggregateDays));
      this.database.prepare("DELETE FROM hourly_dependency_aggregates WHERE hour < ?").run(cutoff(aggregateDays));
      this.database.prepare("DELETE FROM health_samples WHERE timestamp < ?").run(cutoff(aggregateDays));
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  private insertOccurrence(value: Occurrence): void {
    const requestStatus = value.request?.statusCode ?? 0;
    const inserted = this.database.prepare("INSERT OR IGNORE INTO occurrences (id, operation, started_at, duration_ms, status, service, environment, trace_id, span_id, parent_id, context_json, error_json, db_duration_ms, request_status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(value.id, value.operation, value.startedAt, value.durationMs, value.status, value.service, value.environment, value.distributed.traceId, value.distributed.spanId, value.distributed.parentId ?? null, JSON.stringify(value.context), value.error ? JSON.stringify(value.error) : null, value.database.totalDurationMs, requestStatus, JSON.stringify(value));
    if (!inserted.changes) return;
    const dbStatement = this.database.prepare("INSERT INTO database_operations (id, occurrence_id, operation, service, started_at, model, action, duration_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const item of value.database.operations) dbStatement.run(item.id, value.id, value.operation, value.service, value.startedAt, item.model, item.action, item.durationMs, item.status);
    const dependencyStatement = this.database.prepare("INSERT INTO dependency_operations (id, occurrence_id, operation, service, started_at, host, method, path, duration_ms, status, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const item of value.dependencies) dependencyStatement.run(item.id, value.id, value.operation, value.service, value.startedAt, item.host, item.method, item.path, item.durationMs, item.status, item.statusCode ?? null);
    this.upsertAggregate(value);
    this.upsertChildAggregates(value);
  }

  private upsertAggregate(value: Occurrence): void {
    const hour = `${value.startedAt.slice(0, 13)}:00:00.000Z`;
    const current = this.database.prepare("SELECT latencies_json latencies FROM hourly_aggregates WHERE hour = ? AND service = ? AND environment = ? AND operation = ?").get(hour, value.service, value.environment, value.operation) as Row | undefined;
    const latencies = current ? safeNumbers(String(current.latencies)) : [];
    if (latencies.length < 2048) latencies.push(value.durationMs);
    else latencies[Math.floor(Math.random() * latencies.length)] = value.durationMs;
    this.database.prepare(`INSERT INTO hourly_aggregates (hour, service, environment, operation, call_count, error_count, unauthorized_count, duration_sum, db_duration_sum, latencies_json) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT(hour, service, environment, operation) DO UPDATE SET call_count=call_count+1, error_count=error_count+excluded.error_count, unauthorized_count=unauthorized_count+excluded.unauthorized_count, duration_sum=duration_sum+excluded.duration_sum, db_duration_sum=db_duration_sum+excluded.db_duration_sum, latencies_json=excluded.latencies_json`).run(hour, value.service, value.environment, value.operation, value.status === "error" ? 1 : 0, value.request?.statusCode === 401 || value.request?.statusCode === 403 ? 1 : 0, value.durationMs, value.database.totalDurationMs, JSON.stringify(latencies));
  }

  private insertMeter(value: UsageEvent): void {
    const inserted = this.database.prepare("INSERT OR IGNORE INTO meters (id, occurrence_id, timestamp, service, environment, tenant_id, meter, unit, quantity, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(value.id, value.occurrenceId, value.timestamp, value.service, value.environment, value.tenantId ?? null, value.meter, value.unit ?? null, value.quantity, JSON.stringify(value.attributes));
    if (!inserted.changes) return;
    const hour = `${value.timestamp.slice(0, 13)}:00:00.000Z`;
    this.database.prepare("INSERT INTO hourly_meter_aggregates (hour, service, environment, tenant_id, meter, unit, quantity_sum, event_count) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(hour, service, environment, tenant_id, meter, unit) DO UPDATE SET quantity_sum=quantity_sum+excluded.quantity_sum, event_count=event_count+1").run(hour, value.service, value.environment, value.tenantId ?? "", value.meter, value.unit ?? "", value.quantity);
  }

  private insertHealth(value: HealthSample): void {
    const previous = this.database.prepare("SELECT pid, uptime_seconds uptime FROM health_samples WHERE service = ? AND environment = ? ORDER BY timestamp DESC LIMIT 1").get(value.service, value.environment) as Row | undefined;
    const restarted = previous && (Number(previous.pid) !== value.pid || Number(previous.uptime) > value.uptimeSeconds) ? 1 : 0;
    this.database.prepare("INSERT OR IGNORE INTO health_samples (id, service, environment, timestamp, cpu_percent, memory_rss_bytes, heap_used_bytes, event_loop_lag_ms, uptime_seconds, pid, host_memory_total_bytes, host_memory_free_bytes, host_load_1m, disk_total_bytes, disk_free_bytes, restart_detected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(value.id, value.service, value.environment, value.timestamp, value.cpuPercent, value.memoryRssBytes, value.memoryHeapUsedBytes, value.eventLoopLagMs, value.uptimeSeconds, value.pid, value.hostMemoryTotalBytes ?? 0, value.hostMemoryFreeBytes ?? 0, value.hostLoad1m ?? 0, value.diskTotalBytes ?? null, value.diskFreeBytes ?? null, restarted);
  }

  private upsertChildAggregates(value: Occurrence): void {
    const hour = `${value.startedAt.slice(0, 13)}:00:00.000Z`;
    const db = this.database.prepare("INSERT INTO hourly_database_aggregates (hour, service, environment, source_operation, model, action, call_count, error_count, duration_sum, duration_max) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(hour, service, environment, source_operation, model, action) DO UPDATE SET call_count=call_count+1, error_count=error_count+excluded.error_count, duration_sum=duration_sum+excluded.duration_sum, duration_max=MAX(duration_max, excluded.duration_max)");
    for (const item of value.database.operations) db.run(hour, value.service, value.environment, value.operation, item.model, item.action, item.status === "error" ? 1 : 0, item.durationMs, item.durationMs);
    const dependency = this.database.prepare("INSERT INTO hourly_dependency_aggregates (hour, service, environment, source_operation, host, method, path, call_count, error_count, duration_sum, duration_max) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(hour, service, environment, source_operation, host, method, path) DO UPDATE SET call_count=call_count+1, error_count=error_count+excluded.error_count, duration_sum=duration_sum+excluded.duration_sum, duration_max=MAX(duration_max, excluded.duration_max)");
    for (const item of value.dependencies) dependency.run(hour, value.service, value.environment, value.operation, item.host, item.method, item.path, item.status === "error" ? 1 : 0, item.durationMs, item.durationMs);
  }

  private migrate(): void {
    this.database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    this.applyMigration(1, () => this.createBaseSchema());
    this.applyMigration(2, () => this.createAggregateSchema());
  }

  schemaVersion(): number {
    const row = this.database.prepare("SELECT COALESCE(MAX(version), 0) version FROM schema_migrations").get() as Row;
    return Number(row.version);
  }

  private applyMigration(version: number, migration: () => void): void {
    const found = this.database.prepare("SELECT 1 found FROM schema_migrations WHERE version = ?").get(version);
    if (found) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      migration();
      this.database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  private createBaseSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS occurrences (id TEXT PRIMARY KEY, operation TEXT NOT NULL, started_at TEXT NOT NULL, duration_ms REAL NOT NULL, status TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, trace_id TEXT NOT NULL, span_id TEXT NOT NULL, parent_id TEXT, context_json TEXT NOT NULL, error_json TEXT, db_duration_ms REAL NOT NULL DEFAULT 0, request_status INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_occurrences_time ON occurrences(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_occurrences_operation_time ON occurrences(operation, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_occurrences_service_time ON occurrences(service, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_occurrences_status_time ON occurrences(status, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_occurrences_trace ON occurrences(trace_id);
      CREATE TABLE IF NOT EXISTS hourly_aggregates (hour TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, operation TEXT NOT NULL, call_count INTEGER NOT NULL, error_count INTEGER NOT NULL, unauthorized_count INTEGER NOT NULL, duration_sum REAL NOT NULL, db_duration_sum REAL NOT NULL, latencies_json TEXT NOT NULL, PRIMARY KEY(hour, service, environment, operation));
      CREATE INDEX IF NOT EXISTS idx_hourly_aggregates_hour ON hourly_aggregates(hour);
      CREATE TABLE IF NOT EXISTS meters (id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL, timestamp TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, tenant_id TEXT, meter TEXT NOT NULL, unit TEXT, quantity REAL NOT NULL, attributes_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_meters_time ON meters(timestamp);
      CREATE INDEX IF NOT EXISTS idx_meters_tenant_time ON meters(tenant_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_meters_name_time ON meters(meter, timestamp);
      CREATE TABLE IF NOT EXISTS database_operations (id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE, operation TEXT NOT NULL, service TEXT NOT NULL, started_at TEXT NOT NULL, model TEXT NOT NULL, action TEXT NOT NULL, duration_ms REAL NOT NULL, status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_database_operations_time ON database_operations(started_at);
      CREATE TABLE IF NOT EXISTS dependency_operations (id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE, operation TEXT NOT NULL, service TEXT NOT NULL, started_at TEXT NOT NULL, host TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, duration_ms REAL NOT NULL, status TEXT NOT NULL, status_code INTEGER);
      CREATE INDEX IF NOT EXISTS idx_dependency_operations_time ON dependency_operations(started_at);
      CREATE TABLE IF NOT EXISTS health_samples (id TEXT PRIMARY KEY, service TEXT NOT NULL, environment TEXT NOT NULL, timestamp TEXT NOT NULL, cpu_percent REAL NOT NULL, memory_rss_bytes INTEGER NOT NULL, heap_used_bytes INTEGER NOT NULL, event_loop_lag_ms REAL NOT NULL, uptime_seconds REAL NOT NULL, pid INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_health_samples_service_time ON health_samples(service, timestamp);
    `);
  }

  private createAggregateSchema(): void {
    const healthColumns = new Set((this.database.prepare("PRAGMA table_info(health_samples)").all() as Row[]).map((row) => String(row.name)));
    const additions: Array<[string, string]> = [
      ["host_memory_total_bytes", "INTEGER NOT NULL DEFAULT 0"], ["host_memory_free_bytes", "INTEGER NOT NULL DEFAULT 0"],
      ["host_load_1m", "REAL NOT NULL DEFAULT 0"], ["disk_total_bytes", "INTEGER"], ["disk_free_bytes", "INTEGER"],
      ["restart_detected", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [column, definition] of additions) if (!healthColumns.has(column)) this.database.exec(`ALTER TABLE health_samples ADD COLUMN ${column} ${definition}`);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS hourly_meter_aggregates (hour TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, tenant_id TEXT NOT NULL, meter TEXT NOT NULL, unit TEXT NOT NULL, quantity_sum REAL NOT NULL, event_count INTEGER NOT NULL, PRIMARY KEY(hour, service, environment, tenant_id, meter, unit));
      CREATE INDEX IF NOT EXISTS idx_hourly_meter_hour ON hourly_meter_aggregates(hour);
      CREATE TABLE IF NOT EXISTS hourly_database_aggregates (hour TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, source_operation TEXT NOT NULL, model TEXT NOT NULL, action TEXT NOT NULL, call_count INTEGER NOT NULL, error_count INTEGER NOT NULL, duration_sum REAL NOT NULL, duration_max REAL NOT NULL, PRIMARY KEY(hour, service, environment, source_operation, model, action));
      CREATE INDEX IF NOT EXISTS idx_hourly_database_hour ON hourly_database_aggregates(hour);
      CREATE TABLE IF NOT EXISTS hourly_dependency_aggregates (hour TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, source_operation TEXT NOT NULL, host TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, call_count INTEGER NOT NULL, error_count INTEGER NOT NULL, duration_sum REAL NOT NULL, duration_max REAL NOT NULL, PRIMARY KEY(hour, service, environment, source_operation, host, method, path));
      CREATE INDEX IF NOT EXISTS idx_hourly_dependency_hour ON hourly_dependency_aggregates(hour);
      INSERT OR IGNORE INTO hourly_meter_aggregates SELECT substr(timestamp, 1, 13) || ':00:00.000Z', service, environment, COALESCE(tenant_id, ''), meter, COALESCE(unit, ''), SUM(quantity), COUNT(*) FROM meters GROUP BY 1, service, environment, tenant_id, meter, unit;
      INSERT OR IGNORE INTO hourly_database_aggregates SELECT substr(started_at, 1, 13) || ':00:00.000Z', service, '', operation, model, action, COUNT(*), SUM(CASE WHEN status='error' THEN 1 ELSE 0 END), SUM(duration_ms), MAX(duration_ms) FROM database_operations GROUP BY 1, service, operation, model, action;
      INSERT OR IGNORE INTO hourly_dependency_aggregates SELECT substr(started_at, 1, 13) || ':00:00.000Z', service, '', operation, host, method, path, COUNT(*), SUM(CASE WHEN status='error' THEN 1 ELSE 0 END), SUM(duration_ms), MAX(duration_ms) FROM dependency_operations GROUP BY 1, service, operation, host, method, path;
    `);
  }
}

function safeNumbers(json: string): number[] { try { const value = JSON.parse(json); return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []; } catch { return []; } }
function hour(value: string): string { return `${value.slice(0, 13)}:00:00.000Z`; }
function ratio(top: number, bottom: number): number { return bottom ? Math.round((top / bottom) * 100) / 100 : 0; }
function percent(top: number, bottom: number): number { return Math.round(ratio(top, bottom) * 10_000) / 100; }
function percentile(values: number[], quantile: number): number { if (!values.length) return 0; values.sort((a, b) => a - b); return Math.round((values[Math.ceil(quantile * values.length) - 1] ?? 0) * 100) / 100; }
function hydrateListRow(row: Row): object { return { ...row, context: JSON.parse(String(row.context)), error: row.error ? JSON.parse(String(row.error)) : undefined }; }
