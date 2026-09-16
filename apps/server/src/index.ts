import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { config } from "./config.js";
import { Store } from "./database.js";
import { defaultAlerts, defaultSmtp, latestBackupPath, Operations } from "./operations.js";
import { apiError, type AuthedRequest, PublicError, Security, type Role } from "./security.js";
import { validateEnvelope } from "./validate.js";

const app = express();
const store = new Store(config.databasePath);
const security = new Security(store.database);
const operations = new Operations(store, security);
const setupLink = security.ensureSetupLink();
if (setupLink) console.log(`Sightglass first-admin setup link (valid for 24 hours): ${setupLink}`);

app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);
app.use((_request, response, next) => {
  response.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
  if (config.secureCookies) response.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains"); next();
});
app.use(express.json({ limit: "1mb", strict: true }));

const loginLimit = limiter(10, 15 * 60_000);
const admin = (request: AuthedRequest, response: express.Response, next: express.NextFunction) => security.require(request, response, true) ? next() : undefined;
const member = (request: AuthedRequest, response: express.Response, next: express.NextFunction) => security.require(request, response) ? next() : undefined;

app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
app.get("/readyz", (_request, response) => { try { store.database.prepare("SELECT 1").get(); response.json({ status: "ready" }); } catch { response.status(503).json({ status: "unavailable" }); } });

app.get("/api/v1/auth/setup-status", (_request, response) => response.json({ required: !security.hasUsers() }));
app.post("/api/v1/auth/setup", loginLimit, async (request, response) => { const password = bodyText(request, "password"); const user = await security.setup(bodyText(request, "token"), bodyText(request, "email"), password, request.ip); response.status(201).json(await security.login(user.email, password, response, request.ip)); });
app.post("/api/v1/auth/login", loginLimit, async (request, response) => response.json(await security.login(bodyText(request, "email"), bodyText(request, "password"), response, request.ip)));
app.get("/api/v1/auth/me", (request: AuthedRequest, response) => { const user = security.require(request, response); if (user) response.json({ user, csrfToken: request.auth!.csrfToken }); });
app.post("/api/v1/auth/logout", (request: AuthedRequest, response) => { if (!security.require(request, response)) return; security.logout(request, response); response.status(204).end(); });
app.post("/api/v1/auth/password/forgot", loginLimit, async (request, response) => { const reset = security.createReset(bodyText(request, "email")); if (reset) void operations.sendMail([reset.email], "Reset your Sightglass password", `Reset your password using this link (valid for one hour):\n\n${reset.url}`).catch(() => undefined); response.status(202).json({ accepted: true }); });
app.post("/api/v1/auth/password/reset", loginLimit, async (request, response) => { await security.resetPassword(bodyText(request, "token"), bodyText(request, "password")); response.status(204).end(); });
app.post("/api/v1/auth/invitations/accept", loginLimit, async (request, response) => { await security.acceptInvite(bodyText(request, "token"), bodyText(request, "password")); response.status(204).end(); });
app.post("/api/v1/auth/password/change", member, async (request: AuthedRequest, response) => { await security.changePassword(request.auth!.user, bodyText(request, "currentPassword"), bodyText(request, "password")); response.status(204).end(); });

app.post("/api/v1/ingest", (request, response) => {
  const bearer = request.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!security.validateIngestionKey(bearer)) return response.status(401).json(apiError("invalid_ingestion_key", "A valid ingestion key is required."));
  try { return response.status(202).json({ accepted: store.ingest(validateEnvelope(request.body)) }); }
  catch (error) { return response.status(400).json(apiError("invalid_payload", error instanceof Error ? error.message : "Invalid payload.")); }
});

app.get("/api/v1/services", member, (_request, response) => response.json(store.services()));
app.get("/api/v1/summary", member, (request, response) => { const range = dateRange(request.query); response.json(store.summary(range.from, range.to, telemetryFilters(request.query))); });
app.get("/api/v1/trend", member, (request, response) => { const range = dateRange(request.query); response.json(store.trend(range.from, range.to, telemetryFilters(request.query))); });
app.get("/api/v1/occurrences", member, (request, response) => { const range = dateRange(request.query); const filters = telemetryFilters(request.query); const operation = text(request.query.operation); const status = text(request.query.status); response.json(store.occurrences({ ...range, ...filters, ...(operation ? { operation } : {}), ...(status ? { status } : {}), limit: clamp(request.query.limit, 1, 200, 50), offset: clamp(request.query.offset, 0, 100_000, 0) })); });
app.get("/api/v1/occurrences/:id", member, (request, response) => { const value = store.occurrence(String(request.params.id)); if (value) response.json(value); else response.status(404).json(apiError("not_found", "Occurrence not found.")); });
app.get("/api/v1/traces/:traceId", member, (request, response) => response.json(store.trace(String(request.params.traceId))));
app.get("/api/v1/database", member, (request, response) => { const range = dateRange(request.query); response.json(store.databaseRanking(range.from, range.to, telemetryFilters(request.query))); });
app.get("/api/v1/dependencies", member, (request, response) => { const range = dateRange(request.query); response.json(store.dependencyRanking(range.from, range.to, telemetryFilters(request.query))); });
app.get("/api/v1/usage", member, (request, response) => { const range = dateRange(request.query); const tenantId = text(request.query.tenantId); response.json(store.usage(range.from, range.to, { ...telemetryFilters(request.query), ...(tenantId ? { tenantId } : {}) })); });
app.get("/api/v1/usage/trend", member, (request, response) => { const range = dateRange(request.query); response.json(store.usageTrend(range.from, range.to, telemetryFilters(request.query))); });
app.get("/api/v1/usage/export", member, (request, response) => {
  const range = dateRange(request.query); const rows = store.usageRows(range.from, range.to, telemetryFilters(request.query));
  if (text(request.query.format) === "json") return response.attachment("sightglass-usage.json").json(rows.map((row) => ({ ...row, attributes: JSON.parse(String(row.attributes)) })));
  const columns = ["id", "timestamp", "service", "environment", "tenantId", "meter", "unit", "quantity", "occurrenceId"];
  response.type("text/csv").attachment("sightglass-usage.csv").send([columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n"));
});
app.get("/api/v1/health", member, (request, response) => { const range = dateRange(request.query); response.json(store.health(range.from, range.to, telemetryFilters(request.query))); });

app.get("/api/v1/admin/overview", admin, async (_request, response) => response.json({ users: security.listUsers(), ingestionKeys: security.listIngestionKeys(), smtp: security.getSetting("smtp", defaultSmtp), alerts: security.getSetting("alerts", defaultAlerts), backups: operations.backupStatus(), update: await operations.checkUpdate(), audit: security.audits() }));
app.post("/api/v1/admin/users", admin, async (request: AuthedRequest, response) => response.status(201).json(await security.createUser(request.auth!.user, bodyText(request, "email"), bodyRole(request), request.ip)));
app.patch("/api/v1/admin/users/:id", admin, (request: AuthedRequest, response) => { const role = request.body?.role as Role | undefined; const status = request.body?.status as "active" | "disabled" | undefined; security.updateUser(request.auth!.user, String(request.params.id), { ...(role ? { role } : {}), ...(status ? { status } : {}) }, request.ip); response.status(204).end(); });
app.post("/api/v1/admin/invitations", admin, async (request: AuthedRequest, response) => { const email = bodyText(request, "email"); const invite = security.invite(request.auth!.user, email, bodyRole(request), request.ip); let sent = false; try { await operations.sendMail([email], "You are invited to Sightglass", `Create your account using this link:\n\n${invite.url}`); sent = true; } catch { /* link remains copyable */ } response.status(201).json({ url: invite.url, sent }); });
app.get("/api/v1/admin/ingestion-keys", admin, (_request, response) => response.json(security.listIngestionKeys()));
app.post("/api/v1/admin/ingestion-keys", admin, (request: AuthedRequest, response) => response.status(201).json(security.createIngestionKey(request.auth!.user, bodyText(request, "name"), request.ip)));
app.delete("/api/v1/admin/ingestion-keys/:id", admin, (request: AuthedRequest, response) => { security.revokeIngestionKey(request.auth!.user, String(request.params.id), request.ip); response.status(204).end(); });
app.put("/api/v1/admin/settings/smtp", admin, (request: AuthedRequest, response) => { const value = smtpBody(request); const password = String(request.body?.password ?? ""); security.setSetting(request.auth!.user, "smtp", value, password ? { password } : undefined, request.ip); response.json(value); });
app.post("/api/v1/admin/settings/smtp/test", admin, async (request: AuthedRequest, response) => { await operations.testSmtp(request.auth!.user.email); response.status(204).end(); });
app.put("/api/v1/admin/settings/alerts", admin, (request: AuthedRequest, response) => { const value = alertBody(request); security.setSetting(request.auth!.user, "alerts", value, undefined, request.ip); response.json(value); });
app.put("/api/v1/admin/settings/backups", admin, (request: AuthedRequest, response) => { const value = backupBody(request); const secretAccessKey = String(request.body?.secretAccessKey ?? ""); const secret = secretAccessKey ? { accessKeyId: String(request.body.accessKeyId ?? ""), secretAccessKey } : undefined; security.setSetting(request.auth!.user, "backups", value, secret, request.ip); response.json(value); });
app.post("/api/v1/admin/backups", admin, async (_request, response) => response.status(201).json(await operations.runBackup()));
app.get("/api/v1/admin/backups/latest", admin, (_request, response) => { const path = latestBackupPath(config.databasePath); if (!path) response.status(404).json(apiError("not_found", "No backup is available.")); else response.download(path); });
app.post("/api/v1/admin/update/check", admin, async (_request, response) => response.json(await operations.checkUpdate(true)));

if (existsSync(config.dashboardPath)) { app.use(express.static(config.dashboardPath, { maxAge: "1h", index: false })); const dashboard = (_request: express.Request, response: express.Response) => response.sendFile(join(config.dashboardPath, "index.html")); app.get("/", dashboard); app.get("/{*path}", dashboard); }
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { void _next; if (error instanceof PublicError) response.status(error.status).json(apiError(error.code, error.message)); else if (error instanceof SyntaxError) response.status(400).json(apiError("invalid_json", "Invalid JSON.")); else { console.error("Sightglass request failed", error); response.status(500).json(apiError("internal_error", "An internal error occurred.")); } });

const cleanup = () => { try { store.cleanup(config.successRetentionDays, config.errorRetentionDays, config.aggregateRetentionDays); } catch (error) { console.error("Sightglass retention cleanup failed", error); } };
cleanup(); void operations.tick(); const cleanupTimer = setInterval(cleanup, 6 * 60 * 60_000); cleanupTimer.unref(); const operationsTimer = setInterval(() => void operations.tick(), 5 * 60_000); operationsTimer.unref();
const server = app.listen(config.port, "0.0.0.0", () => console.log(`Sightglass listening on http://0.0.0.0:${config.port}`));
const stop = () => server.close(() => { clearInterval(cleanupTimer); clearInterval(operationsTimer); try { store.database.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { store.database.close(); process.exit(0); } }); process.once("SIGINT", stop); process.once("SIGTERM", stop);

function dateRange(query: Record<string, unknown>): { from: string; to: string } { const nowDate = new Date(); const fallback = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000); return { from: validDate(query.from) ?? fallback.toISOString(), to: validDate(query.to) ?? nowDate.toISOString() }; }
function validDate(value: unknown): string | undefined { if (typeof value !== "string") return; const date = new Date(value); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); }
function text(value: unknown): string | undefined { return typeof value === "string" && value.length <= 128 ? value : undefined; }
function telemetryFilters(query: Record<string, unknown>): { service?: string; environment?: string } { const service = text(query.service); const environment = text(query.environment); return { ...(service ? { service } : {}), ...(environment ? { environment } : {}) }; }
function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number { const number = Number(value); return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback; }
function csvCell(value: unknown): string { const content = value === null || value === undefined ? "" : String(value); return `"${content.replaceAll('"', '""')}"`; }
function bodyText(request: express.Request, name: string): string { const value = request.body?.[name]; if (typeof value !== "string" || value.length > 512) throw new PublicError(400, "invalid_input", `${name} is required.`); return value; }
function bodyRole(request: express.Request): Role { const role = request.body?.role; if (role !== "admin" && role !== "user") throw new PublicError(400, "invalid_role", "Role must be admin or user."); return role; }
function smtpBody(request: express.Request) { return { enabled: Boolean(request.body?.enabled), host: bodyText(request, "host"), port: clamp(request.body?.port, 1, 65_535, 587), secure: Boolean(request.body?.secure), username: String(request.body?.username ?? "").slice(0, 254), from: bodyText(request, "from") }; }
function alertBody(request: express.Request) { return { enabled: Boolean(request.body?.enabled), recipients: Array.isArray(request.body?.recipients) ? request.body.recipients.filter((item: unknown) => typeof item === "string").slice(0, 100) : [], errorRate: clamp(request.body?.errorRate, 1, 100, 5), p95Ms: clamp(request.body?.p95Ms, 1, 600_000, 1000), silenceMinutes: clamp(request.body?.silenceMinutes, 1, 43_200, 15), diskFreePercent: clamp(request.body?.diskFreePercent, 1, 99, 10) }; }
function backupBody(request: express.Request) { return { enabled: Boolean(request.body?.enabled), localRetention: clamp(request.body?.localRetention, 1, 365, 7), s3Enabled: Boolean(request.body?.s3Enabled), endpoint: String(request.body?.endpoint ?? "").slice(0, 500), region: String(request.body?.region ?? "us-east-1").slice(0, 100), bucket: String(request.body?.bucket ?? "").slice(0, 255), prefix: String(request.body?.prefix ?? "sightglass").slice(0, 255), forcePathStyle: Boolean(request.body?.forcePathStyle), remoteRetention: clamp(request.body?.remoteRetention, 1, 365, 14) }; }
function limiter(limit: number, windowMs: number): express.RequestHandler { const hits = new Map<string, number[]>(); return (request, response, next) => { const key = request.ip ?? "unknown"; const cutoff = Date.now() - windowMs; const current = (hits.get(key) ?? []).filter((value) => value > cutoff); if (current.length >= limit) { response.status(429).json(apiError("rate_limited", "Too many attempts. Try again later.")); return; } current.push(Date.now()); hits.set(key, current); next(); }; }
