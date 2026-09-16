import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import type { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import { config } from "./config.js";

export type Role = "admin" | "user";
export type CurrentUser = { id: string; email: string; role: Role; mustChangePassword: boolean };
export type AuthedRequest = Request & { auth?: { user: CurrentUser; sessionId: string; csrfToken: string } };
type Row = Record<string, unknown>;
const SESSION_COOKIE = "sg_session";
const DAY = 86_400_000;

export class Security {
  readonly secret: Buffer;
  constructor(readonly database: DatabaseSync) { this.secret = loadSecret(); }

  hasUsers(): boolean { return Number((this.database.prepare("SELECT COUNT(*) count FROM users").get() as Row).count) > 0; }

  ensureSetupLink(): string | undefined {
    if (this.hasUsers()) return;
    const existing = this.database.prepare("SELECT 1 ok FROM auth_tokens WHERE kind='setup' AND used_at IS NULL AND expires_at > ? LIMIT 1").get(now());
    if (existing) return;
    return this.createSetupLink();
  }

  createSetupLink(): string {
    if (this.hasUsers()) throw new PublicError(409, "setup_closed", "The installation already has an administrator.");
    this.database.prepare("DELETE FROM auth_tokens WHERE kind='setup'").run();
    const token = opaque(); const created = now();
    this.database.prepare("INSERT INTO auth_tokens (id, kind, token_hash, created_at, expires_at) VALUES (?, 'setup', ?, ?, ?)").run(randomUUID(), digest(token), created, new Date(Date.now() + DAY).toISOString());
    return `${config.publicUrl ?? `http://localhost:${config.port}`}/?setup=${encodeURIComponent(token)}`;
  }

  async setup(token: string, email: string, password: string, ip?: string): Promise<CurrentUser> {
    validatePassword(password); const normalized = normalizeEmail(email);
    const passwordHash = await passwordHashFor(password);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.hasUsers()) throw new PublicError(409, "setup_closed", "Setup is already complete.");
      const found = this.token(token, "setup");
      const id = randomUUID(); const timestamp = now();
      this.database.prepare("INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,'admin','active',?,?)").run(id, normalized, passwordHash, timestamp, timestamp);
      this.database.prepare("UPDATE auth_tokens SET used_at=? WHERE id=?").run(timestamp, String(found.id));
      this.database.exec("COMMIT");
      this.audit(id, "setup.completed", ip, {});
      return { id, email: normalized, role: "admin", mustChangePassword: false };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  async login(email: string, password: string, response: Response, ip?: string): Promise<{ user: CurrentUser; csrfToken: string }> {
    const row = this.database.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(normalizeEmail(email)) as Row | undefined;
    if (!row || row.status !== "active" || !(await verify(String(row.password_hash), password))) {
      this.audit(row ? String(row.id) : undefined, "auth.login_failed", ip, { email: normalizeEmail(email) });
      throw new PublicError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    const user = hydrateUser(row); const session = this.createSession(user.id, response);
    this.audit(user.id, "auth.login", ip, {});
    return { user, csrfToken: session.csrfToken };
  }

  authenticate(request: AuthedRequest): CurrentUser | undefined {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token) return;
    const row = this.database.prepare("SELECT s.id session_id,s.csrf_token,s.expires_at,s.last_seen_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?").get(digest(token)) as Row | undefined;
    if (!row || row.status !== "active" || String(row.expires_at) <= now() || Date.now() - new Date(String(row.last_seen_at)).valueOf() > DAY) {
      if (row) this.database.prepare("DELETE FROM sessions WHERE id=?").run(String(row.session_id));
      return;
    }
    if (Date.now() - new Date(String(row.last_seen_at)).valueOf() > 300_000) this.database.prepare("UPDATE sessions SET last_seen_at=? WHERE id=?").run(now(), String(row.session_id));
    const user = hydrateUser(row); request.auth = { user, sessionId: String(row.session_id), csrfToken: String(row.csrf_token) };
    return user;
  }

  require(request: AuthedRequest, response: Response, admin = false): CurrentUser | undefined {
    const user = this.authenticate(request);
    if (!user) { response.status(401).json(apiError("authentication_required", "Sign in to continue.")); return; }
    if (admin && user.role !== "admin") { response.status(403).json(apiError("admin_required", "Administrator access is required.")); return; }
    if (!safeMethod(request.method) && request.header("x-csrf-token") !== request.auth?.csrfToken) { response.status(403).json(apiError("invalid_csrf", "Refresh the page and try again.")); return; }
    return user;
  }

  logout(request: AuthedRequest, response: Response): void {
    this.authenticate(request);
    if (request.auth) this.database.prepare("DELETE FROM sessions WHERE id=?").run(request.auth.sessionId);
    clearCookie(response);
  }

  listUsers(): object[] { return this.database.prepare("SELECT id,email,role,status,must_change_password mustChangePassword,created_at createdAt FROM users ORDER BY created_at").all() as object[]; }

  async createUser(actor: CurrentUser, email: string, role: Role, ip?: string): Promise<{ user: object; temporaryPassword: string }> {
    const normalized = normalizeEmail(email); const temporaryPassword = randomBytes(12).toString("base64url"); const timestamp = now(); const id = randomUUID();
    if (this.database.prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE").get(normalized)) throw new PublicError(409, "email_exists", "A user with that email already exists.");
    this.database.prepare("INSERT INTO users (id,email,password_hash,role,status,must_change_password,created_at,updated_at) VALUES (?,?,?,?,'active',1,?,?)").run(id, normalized, await passwordHashFor(temporaryPassword), role, timestamp, timestamp);
    this.audit(actor.id, "user.created", ip, { targetId: id, role });
    return { user: { id, email: normalized, role, status: "active", mustChangePassword: true, createdAt: timestamp }, temporaryPassword };
  }

  invite(actor: CurrentUser, email: string, role: Role, ip?: string): { url: string; token: string } {
    const normalized = normalizeEmail(email);
    if (this.database.prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE").get(normalized)) throw new PublicError(409, "email_exists", "A user with that email already exists.");
    this.database.prepare("DELETE FROM auth_tokens WHERE kind='invite' AND email=?").run(normalized);
    const token = opaque(); const timestamp = now();
    this.database.prepare("INSERT INTO auth_tokens (id,email,role,kind,token_hash,created_at,expires_at) VALUES (?,?,?,'invite',?,?,?)").run(randomUUID(), normalized, role, digest(token), timestamp, new Date(Date.now() + 7 * DAY).toISOString());
    this.audit(actor.id, "user.invited", ip, { email: normalized, role });
    return { token, url: `${config.publicUrl ?? `http://localhost:${config.port}`}/?invite=${encodeURIComponent(token)}` };
  }

  async acceptInvite(token: string, password: string): Promise<void> {
    validatePassword(password); const found = this.token(token, "invite"); const timestamp = now(); const passwordHash = await passwordHashFor(password);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)").run(randomUUID(), String(found.email), passwordHash, String(found.role), timestamp, timestamp);
      this.database.prepare("UPDATE auth_tokens SET used_at=? WHERE id=?").run(timestamp, String(found.id)); this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  createReset(email: string): { email: string; url: string } | undefined {
    const user = this.database.prepare("SELECT id,email FROM users WHERE email=? COLLATE NOCASE AND status='active'").get(normalizeEmail(email)) as Row | undefined;
    if (!user) return;
    const token = opaque(); const timestamp = now(); this.database.prepare("DELETE FROM auth_tokens WHERE kind='reset' AND user_id=?").run(String(user.id));
    this.database.prepare("INSERT INTO auth_tokens (id,user_id,email,kind,token_hash,created_at,expires_at) VALUES (?,?,?,'reset',?,?,?)").run(randomUUID(), String(user.id), String(user.email), digest(token), timestamp, new Date(Date.now() + 3_600_000).toISOString());
    return { email: String(user.email), url: `${config.publicUrl ?? `http://localhost:${config.port}`}/?reset=${encodeURIComponent(token)}` };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    validatePassword(password); const found = this.token(token, "reset"); const timestamp = now();
    this.database.prepare("UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?").run(await passwordHashFor(password), timestamp, String(found.user_id));
    this.database.prepare("UPDATE auth_tokens SET used_at=? WHERE id=?").run(timestamp, String(found.id)); this.database.prepare("DELETE FROM sessions WHERE user_id=?").run(String(found.user_id));
  }

  async changePassword(user: CurrentUser, current: string, password: string): Promise<void> {
    validatePassword(password); const row = this.database.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id) as Row;
    if (!(await verify(String(row.password_hash), current))) throw new PublicError(400, "invalid_password", "Current password is incorrect.");
    this.database.prepare("UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?").run(await passwordHashFor(password), now(), user.id);
  }

  updateUser(actor: CurrentUser, id: string, changes: { role?: Role; status?: "active" | "disabled" }, ip?: string): void {
    const target = this.database.prepare("SELECT role,status FROM users WHERE id=?").get(id) as Row | undefined;
    if (!target) throw new PublicError(404, "not_found", "User not found.");
    if (changes.role && changes.role !== "admin" && changes.role !== "user") throw new PublicError(400, "invalid_role", "Role must be admin or user.");
    if (changes.status && changes.status !== "active" && changes.status !== "disabled") throw new PublicError(400, "invalid_status", "Status must be active or disabled.");
    const removingAdmin = target.role === "admin" && (changes.role === "user" || changes.status === "disabled");
    if (removingAdmin && Number((this.database.prepare("SELECT COUNT(*) count FROM users WHERE role='admin' AND status='active'").get() as Row).count) <= 1) throw new PublicError(409, "last_admin", "The final active administrator cannot be removed.");
    this.database.prepare("UPDATE users SET role=COALESCE(?,role),status=COALESCE(?,status),updated_at=? WHERE id=?").run(changes.role ?? null, changes.status ?? null, now(), id);
    if (changes.status === "disabled") this.database.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    this.audit(actor.id, "user.updated", ip, { targetId: id, ...changes });
  }

  createIngestionKey(actor: CurrentUser, name: string, ip?: string): { id: string; name: string; key: string; prefix: string; createdAt: string } {
    if (!name.trim() || name.length > 80) throw new PublicError(400, "invalid_name", "Key name is required.");
    const secret = `sg_${opaque()}`; const id = randomUUID(); const timestamp = now(); const prefix = secret.slice(0, 11);
    this.database.prepare("INSERT INTO ingestion_keys (id,name,key_prefix,key_hash,created_at) VALUES (?,?,?,?,?)").run(id, name.trim(), prefix, digest(secret), timestamp);
    this.audit(actor.id, "ingestion_key.created", ip, { keyId: id, name: name.trim() }); return { id, name: name.trim(), key: secret, prefix, createdAt: timestamp };
  }

  listIngestionKeys(): object[] { return this.database.prepare("SELECT id,name,key_prefix prefix,created_at createdAt,last_used_at lastUsedAt,revoked_at revokedAt FROM ingestion_keys ORDER BY created_at DESC").all() as object[]; }
  revokeIngestionKey(actor: CurrentUser, id: string, ip?: string): void { this.database.prepare("UPDATE ingestion_keys SET revoked_at=? WHERE id=?").run(now(), id); this.audit(actor.id, "ingestion_key.revoked", ip, { keyId: id }); }
  validateIngestionKey(value: string | undefined): boolean {
    if (!value) return false; if (config.apiKey && value === config.apiKey) return true;
    const row = this.database.prepare("SELECT id FROM ingestion_keys WHERE key_hash=? AND revoked_at IS NULL").get(digest(value)) as Row | undefined;
    if (!row) return false; this.database.prepare("UPDATE ingestion_keys SET last_used_at=? WHERE id=?").run(now(), String(row.id)); return true;
  }

  getSetting<T>(key: string, fallback: T): T { const row = this.database.prepare("SELECT value_json FROM settings WHERE key=?").get(key) as Row | undefined; return row ? JSON.parse(String(row.value_json)) as T : fallback; }
  getSecret<T>(key: string): T | undefined { const row = this.database.prepare("SELECT secret_cipher FROM settings WHERE key=?").get(key) as Row | undefined; return row?.secret_cipher ? JSON.parse(decrypt(String(row.secret_cipher), this.secret)) as T : undefined; }
  setSetting(actor: CurrentUser, key: string, value: unknown, secret?: unknown, ip?: string): void {
    const prior = this.database.prepare("SELECT secret_cipher FROM settings WHERE key=?").get(key) as Row | undefined;
    const cipher = secret === undefined ? (prior?.secret_cipher ? String(prior.secret_cipher) : null) : encrypt(JSON.stringify(secret), this.secret);
    this.database.prepare("INSERT INTO settings (key,value_json,secret_cipher,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,secret_cipher=excluded.secret_cipher,updated_at=excluded.updated_at").run(key, JSON.stringify(value), cipher, now());
    this.audit(actor.id, "settings.updated", ip, { key });
  }

  audit(userId: string | undefined, event: string, ip: string | undefined, details: unknown): void { this.database.prepare("INSERT INTO audit_log (id,user_id,event,ip,details_json,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), userId ?? null, event, ip ?? null, JSON.stringify(details), now()); }
  audits(): object[] { return this.database.prepare("SELECT a.id,a.event,a.ip,a.details_json details,a.created_at createdAt,u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200").all().map((row) => ({ ...(row as Row), details: JSON.parse(String((row as Row).details)) })); }
  activeRecipientEmails(ids: string[]): string[] { const rows = ids.length ? this.database.prepare(`SELECT email FROM users WHERE status='active' AND id IN (${ids.map(() => "?").join(",")})`).all(...ids) : this.database.prepare("SELECT email FROM users WHERE status='active' AND role='admin'").all(); return (rows as Row[]).map((row) => String(row.email)); }

  private createSession(userId: string, response: Response): { csrfToken: string } {
    const token = opaque(); const csrfToken = opaque(); const timestamp = now();
    this.database.prepare("INSERT INTO sessions (id,user_id,token_hash,csrf_token,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), userId, digest(token), csrfToken, timestamp, timestamp, new Date(Date.now() + 7 * DAY).toISOString());
    response.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${config.secureCookies ? "; Secure" : ""}`); return { csrfToken };
  }
  private token(value: string, kind: string): Row { const row = this.database.prepare("SELECT * FROM auth_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?").get(digest(value), kind, now()) as Row | undefined; if (!row) throw new PublicError(400, "invalid_token", "This link is invalid or expired."); return row; }
}

export class PublicError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
export const apiError = (code: string, message: string) => ({ error: { code, message } });
export const now = () => new Date().toISOString();
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const normalizeEmail = (value: string) => { const email = value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new PublicError(400, "invalid_email", "Enter a valid email address."); return email; };
const validatePassword = (value: string) => { if (value.length < 12 || value.length > 128) throw new PublicError(400, "invalid_password", "Passwords must be between 12 and 128 characters."); };
const passwordHashFor = (password: string) => hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
const hydrateUser = (row: Row): CurrentUser => ({ id: String(row.id), email: String(row.email), role: row.role as Role, mustChangePassword: Boolean(row.must_change_password) });
const parseCookies = (header?: string) => Object.fromEntries((header ?? "").split(";").map((part) => part.trim().split("=")).filter((pair) => pair.length === 2).map(([key, value]) => [key!, decodeURIComponent(value!)]));
const clearCookie = (response: Response) => response.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookies ? "; Secure" : ""}`);
const safeMethod = (method: string) => method === "GET" || method === "HEAD" || method === "OPTIONS";
function loadSecret(): Buffer { const path = join(dirname(config.databasePath), ".secret"); let value = config.installationSecret; if (!value && existsSync(path)) value = readFileSync(path, "utf8").trim(); if (!value) { mkdirSync(dirname(path), { recursive: true }); value = randomBytes(32).toString("base64url"); writeFileSync(path, value, { mode: 0o600 }); } return createHash("sha256").update(value).digest(); }
function encrypt(value: string, key: Buffer): string { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64url"); }
function decrypt(value: string, key: Buffer): string { try { const data = Buffer.from(value, "base64url"); const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"); } catch { throw new PublicError(500, "secret_unavailable", "Stored credentials cannot be decrypted; re-enter them in Settings."); } }
