import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { config } from "./config.js";
import { Store } from "./database.js";
import { validateEnvelope } from "./validate.js";

const app = express();
const store = new Store(config.databasePath);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb", strict: true }));

app.get("/healthz", (_request, response) => response.json({ status: "ok" }));

app.post("/api/v1/ingest", (request, response) => {
  if (config.apiKey && request.header("authorization") !== `Bearer ${config.apiKey}`) return response.status(401).json({ error: "unauthorized" });
  try { return response.status(202).json({ accepted: store.ingest(validateEnvelope(request.body)) }); }
  catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : "invalid payload" }); }
});

app.get("/api/v1/services", (_request, response) => response.json(store.services()));
app.get("/api/v1/summary", (request, response) => { const range = dateRange(request.query); response.json(store.summary(range.from, range.to, text(request.query.service))); });
app.get("/api/v1/occurrences", (request, response) => { const range = dateRange(request.query); const service = text(request.query.service); const operation = text(request.query.operation); const status = text(request.query.status); response.json(store.occurrences({ ...range, ...(service ? { service } : {}), ...(operation ? { operation } : {}), ...(status ? { status } : {}), limit: clamp(request.query.limit, 1, 200, 50), offset: clamp(request.query.offset, 0, 100_000, 0) })); });
app.get("/api/v1/occurrences/:id", (request, response) => { const value = store.occurrence(request.params.id); if (value) response.json(value); else response.status(404).json({ error: "not found" }); });
app.get("/api/v1/database", (request, response) => { const range = dateRange(request.query); response.json(store.databaseRanking(range.from, range.to)); });
app.get("/api/v1/dependencies", (request, response) => { const range = dateRange(request.query); response.json(store.dependencyRanking(range.from, range.to)); });
app.get("/api/v1/usage", (request, response) => { const range = dateRange(request.query); response.json(store.usage(range.from, range.to, text(request.query.tenantId))); });
app.get("/api/v1/usage/export", (request, response) => {
  const range = dateRange(request.query); const rows = store.usageRows(range.from, range.to);
  if (text(request.query.format) === "json") return response.attachment("sightglass-usage.json").json(rows.map((row) => ({ ...row, attributes: JSON.parse(String(row.attributes)) })));
  const columns = ["id", "timestamp", "service", "environment", "tenantId", "meter", "unit", "quantity", "occurrenceId"];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  response.type("text/csv").attachment("sightglass-usage.csv").send(csv);
});
app.get("/api/v1/health", (request, response) => { const range = dateRange(request.query); response.json(store.health(range.from, range.to)); });

if (existsSync(config.dashboardPath)) {
  app.use(express.static(config.dashboardPath, { maxAge: "1h", index: false }));
  const dashboard = (_request: express.Request, response: express.Response) => response.sendFile(join(config.dashboardPath, "index.html"));
  app.get("/", dashboard);
  app.get("/{*path}", dashboard);
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  if (error instanceof SyntaxError) response.status(400).json({ error: "invalid JSON" });
  else response.status(500).json({ error: "internal error" });
});

const cleanup = () => { try { store.cleanup(config.successRetentionDays, config.errorRetentionDays, config.aggregateRetentionDays); } catch (error) { console.error("Sightglass retention cleanup failed", error); } };
cleanup();
const cleanupTimer = setInterval(cleanup, 6 * 60 * 60 * 1000); cleanupTimer.unref();
const server = app.listen(config.port, () => console.log(`Sightglass listening on http://localhost:${config.port}`));
const stop = () => server.close(() => { store.database.close(); process.exit(0); });
process.once("SIGINT", stop); process.once("SIGTERM", stop);

function dateRange(query: Record<string, unknown>): { from: string; to: string } { const now = new Date(); const fallback = new Date(now.getTime() - 24 * 60 * 60 * 1000); return { from: validDate(query.from) ?? fallback.toISOString(), to: validDate(query.to) ?? now.toISOString() }; }
function validDate(value: unknown): string | undefined { if (typeof value !== "string") return; const date = new Date(value); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); }
function text(value: unknown): string | undefined { return typeof value === "string" && value.length <= 128 ? value : undefined; }
function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number { const number = Number(value); return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback; }
function csvCell(value: unknown): string { const content = value === null || value === undefined ? "" : String(value); return `"${content.replaceAll('"', '""')}"`; }
