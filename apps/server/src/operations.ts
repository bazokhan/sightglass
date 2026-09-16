import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import type { Store } from "./database.js";
import { config } from "./config.js";
import { now, Security } from "./security.js";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
export type SmtpSettings = { enabled: boolean; host: string; port: number; secure: boolean; username: string; from: string };
export type SmtpSecret = { password: string };
export type BackupSettings = { enabled: boolean; localRetention: number; s3Enabled: boolean; endpoint: string; region: string; bucket: string; prefix: string; forcePathStyle: boolean; remoteRetention: number };
export type BackupSecret = { accessKeyId: string; secretAccessKey: string };
export type AlertSettings = { enabled: boolean; recipients: string[]; errorRate: number; p95Ms: number; silenceMinutes: number; diskFreePercent: number };

export const defaultSmtp: SmtpSettings = { enabled: false, host: "", port: 587, secure: false, username: "", from: "" };
export const defaultBackups: BackupSettings = { enabled: true, localRetention: 7, s3Enabled: false, endpoint: "", region: "us-east-1", bucket: "", prefix: "sightglass", forcePathStyle: false, remoteRetention: 14 };
export const defaultAlerts: AlertSettings = { enabled: false, recipients: [], errorRate: 5, p95Ms: 1000, silenceMinutes: 15, diskFreePercent: 10 };

export class Operations {
  private backupRunning = false;
  private lastAlertEvaluation = 0;
  private latestRelease?: { current: string; latest?: string; url?: string; checkedAt?: string; error?: string };
  constructor(readonly store: Store, readonly security: Security) {}

  async sendMail(to: string[], subject: string, text: string): Promise<void> {
    const settings = this.security.getSetting("smtp", defaultSmtp); const secret = this.security.getSecret<SmtpSecret>("smtp");
    if (!settings.enabled || !settings.host || !settings.from) throw new Error("SMTP is not configured");
    const transporter = nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.secure, ...(settings.username ? { auth: { user: settings.username, pass: secret?.password ?? "" } } : {}) });
    let error: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) { try { await transporter.sendMail({ from: settings.from, to: to.join(","), subject, text }); return; } catch (reason) { error = reason; } }
    throw error;
  }

  async testSmtp(to: string): Promise<void> { await this.sendMail([to], "Sightglass SMTP test", "Email delivery is working."); }

  async runBackup(): Promise<{ id: string; filename: string; path: string; size: number }> {
    if (this.backupRunning) throw new Error("A backup is already running"); this.backupRunning = true;
    const directory = join(dirname(config.databasePath), "backups"); mkdirSync(directory, { recursive: true });
    const filename = `sightglass-${now().replaceAll(":", "-")}.sqlite`; const path = join(directory, filename); const id = randomUUID();
    this.store.database.prepare("INSERT INTO backup_runs (id,filename,status,created_at) VALUES (?,?,'running',?)").run(id, filename, now());
    try {
      await backup(this.store.database, path); verifyBackup(path); const size = statSync(path).size;
      const settings = this.security.getSetting("backups", defaultBackups); pruneLocal(directory, settings.localRetention);
      if (settings.s3Enabled) await this.uploadS3(path, settings);
      this.store.database.prepare("UPDATE backup_runs SET status='success',size_bytes=?,completed_at=? WHERE id=?").run(size, now(), id);
      return { id, filename, path, size };
    } catch (error) {
      this.store.database.prepare("UPDATE backup_runs SET status='failed',error=?,completed_at=? WHERE id=?").run(message(error), now(), id);
      void this.notifyAdmins("Sightglass backup failed", `The scheduled backup failed:\n\n${message(error)}`); throw error;
    } finally { this.backupRunning = false; }
  }

  backupStatus(): object { return { settings: this.security.getSetting("backups", defaultBackups), runs: this.store.database.prepare("SELECT id,filename,status,size_bytes size,error,created_at createdAt,completed_at completedAt FROM backup_runs ORDER BY created_at DESC LIMIT 20").all() }; }

  async tick(): Promise<void> {
    const backups = this.security.getSetting("backups", defaultBackups);
    if (backups.enabled && !this.backupRunning) {
      const last = this.store.database.prepare("SELECT created_at FROM backup_runs WHERE status='success' ORDER BY created_at DESC LIMIT 1").get() as Row | undefined;
      if (!last || Date.now() - new Date(String(last.created_at)).valueOf() >= 86_400_000) void this.runBackup().catch(() => undefined);
    }
    if (Date.now() - this.lastAlertEvaluation > 300_000) { this.lastAlertEvaluation = Date.now(); void this.evaluateAlerts(); }
  }

  async evaluateAlerts(): Promise<void> {
    const settings = this.security.getSetting("alerts", defaultAlerts); if (!settings.enabled) return;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const occurrence = this.store.database.prepare("SELECT COUNT(*) calls,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errors,payload_json FROM occurrences WHERE started_at>=?").get(since) as Row;
    const durations = (this.store.database.prepare("SELECT duration_ms duration FROM occurrences WHERE started_at>=? ORDER BY duration_ms").all(since) as Row[]).map((row) => Number(row.duration));
    const calls = Number(occurrence.calls ?? 0); const errors = Number(occurrence.errors ?? 0); const p95 = durations[Math.max(0, Math.ceil(durations.length * .95) - 1)] ?? 0;
    await this.alert("error-rate", calls >= 20 && errors / calls * 100 >= settings.errorRate, `Error rate is ${(errors / Math.max(1, calls) * 100).toFixed(1)}% across ${calls} calls.`);
    await this.alert("latency", calls >= 20 && p95 >= settings.p95Ms, `p95 latency is ${Math.round(p95)} ms across ${calls} calls.`);
    const services = this.store.services() as Array<{ service: string; environment: string; lastSeen: string }>;
    const silent = services.filter((item) => Date.now() - new Date(item.lastSeen).valueOf() >= settings.silenceMinutes * 60_000);
    await this.alert("silence", silent.length > 0, silent.length ? `No recent telemetry from: ${silent.map((item) => `${item.service}/${item.environment}`).join(", ")}.` : "Telemetry resumed.");
    const health = this.store.database.prepare("SELECT disk_total_bytes total,disk_free_bytes free,restart_detected restart FROM health_samples WHERE timestamp>=? ORDER BY timestamp DESC LIMIT 100").all(since) as Row[];
    const lowDisk = health.some((row) => Number(row.total) > 0 && Number(row.free) / Number(row.total) * 100 < settings.diskFreePercent);
    await this.alert("disk", lowDisk, `Disk free space is below ${settings.diskFreePercent}%.`);
    const restarted = health.some((row) => Number(row.restart) === 1);
    await this.alert("restart", restarted, "A monitored process restart was detected.");
  }

  async checkUpdate(force = false): Promise<object> {
    if (!config.updateChecks) return { current: config.version, disabled: true };
    if (!force && this.latestRelease?.checkedAt && Date.now() - new Date(this.latestRelease.checkedAt).valueOf() < 86_400_000) return this.latestRelease;
    try {
      const response = await fetch("https://api.github.com/repos/bazokhan/sightglass/releases/latest", { headers: { accept: "application/vnd.github+json", "user-agent": `sightglass/${config.version}` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`); const value = await response.json() as { tag_name?: string; html_url?: string };
      this.latestRelease = { current: config.version, ...(value.tag_name ? { latest: value.tag_name.replace(/^v/, "") } : {}), ...(value.html_url ? { url: value.html_url } : {}), checkedAt: now() };
    } catch (error) { this.latestRelease = { current: config.version, checkedAt: now(), error: message(error) }; }
    return this.latestRelease;
  }

  private async alert(key: string, active: boolean, detail: string): Promise<void> {
    const row = this.store.database.prepare("SELECT active,last_sent_at FROM alert_state WHERE key=?").get(key) as Row | undefined; const wasActive = Boolean(row?.active); const cooldownPassed = !row?.last_sent_at || Date.now() - new Date(String(row.last_sent_at)).valueOf() >= 3_600_000;
    if (active && (!wasActive || cooldownPassed)) { await this.notifyRecipients(`Sightglass alert: ${key}`, detail); this.setAlert(key, true, true); }
    else if (!active && wasActive) { await this.notifyRecipients(`Sightglass recovered: ${key}`, detail); this.setAlert(key, false, true); }
    else this.setAlert(key, active, false);
  }
  private setAlert(key: string, active: boolean, sent: boolean): void { this.store.database.prepare("INSERT INTO alert_state (key,active,last_sent_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET active=excluded.active,last_sent_at=COALESCE(excluded.last_sent_at,alert_state.last_sent_at),updated_at=excluded.updated_at").run(key, active ? 1 : 0, sent ? now() : null, now()); }
  private async notifyRecipients(subject: string, text: string): Promise<void> { const settings = this.security.getSetting("alerts", defaultAlerts); const emails = this.security.activeRecipientEmails(settings.recipients); if (emails.length) await this.sendMail(emails, subject, text).catch(() => undefined); }
  private async notifyAdmins(subject: string, text: string): Promise<void> { const emails = this.security.activeRecipientEmails([]); if (emails.length) await this.sendMail(emails, subject, text).catch(() => undefined); }
  private async uploadS3(path: string, settings: BackupSettings): Promise<void> {
    const secret = this.security.getSecret<BackupSecret>("backups"); if (!secret?.accessKeyId || !secret.secretAccessKey) throw new Error("S3 credentials are missing");
    const client = new S3Client({ region: settings.region, ...(settings.endpoint ? { endpoint: settings.endpoint } : {}), forcePathStyle: settings.forcePathStyle, credentials: secret });
    const key = `${settings.prefix.replace(/^\/+|\/+$/g, "")}/${basename(path)}`; await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: createReadStream(path), ServerSideEncryption: "AES256" }));
    const listed = await client.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: `${settings.prefix.replace(/^\/+|\/+$/g, "")}/` })); const objects = (listed.Contents ?? []).filter((item) => item.Key).sort((a, b) => (b.LastModified?.valueOf() ?? 0) - (a.LastModified?.valueOf() ?? 0));
    const expired = objects.slice(Math.max(1, settings.remoteRetention)); if (expired.length) await client.send(new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: expired.map((item) => ({ Key: item.Key! })) } }));
  }
}

export function verifyBackup(path: string): void { const database = new DatabaseSync(path, { readOnly: true }); try { const result = database.prepare("PRAGMA integrity_check").get() as Row; if (String(Object.values(result)[0]) !== "ok") throw new Error("SQLite integrity check failed"); if (!database.prepare("SELECT 1 FROM schema_migrations LIMIT 1").get()) throw new Error("Not a Sightglass backup"); } finally { database.close(); } }
function pruneLocal(directory: string, retention: number): void { const files = readdirSync(directory).filter((name) => name.endsWith(".sqlite")).map((name) => ({ name, time: statSync(join(directory, name)).mtimeMs })).sort((a, b) => b.time - a.time); for (const file of files.slice(Math.max(1, retention))) unlinkSync(join(directory, file.name)); }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unknown error"; }
export function latestBackupPath(databasePath: string): string | undefined { const directory = join(dirname(databasePath), "backups"); if (!existsSync(directory)) return; const name = readdirSync(directory).filter((item) => item.endsWith(".sqlite")).sort().at(-1); return name ? join(directory, name) : undefined; }
