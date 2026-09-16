import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "../apps/server/src/database.js";

let processHandle: ChildProcess; let origin: string; let directory: string; let cookie = ""; let csrf = "";

beforeAll(async () => {
  const port = await availablePort(); origin = `http://127.0.0.1:${port}`; directory = mkdtempSync(join(tmpdir(), "sightglass-http-"));
  const path = join(directory, "test.sqlite"); const seed = new Store(path); const token = "test-setup-token"; const timestamp = new Date().toISOString(); seed.database.prepare("INSERT INTO auth_tokens (id,kind,token_hash,created_at,expires_at) VALUES (?,'setup',?,?,?)").run(randomUUID(), createHash("sha256").update(token).digest("hex"), timestamp, new Date(Date.now() + 60_000).toISOString()); seed.database.close();
  processHandle = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], { cwd: process.cwd(), env: { ...process.env, SIGHTGLASS_PORT: String(port), SIGHTGLASS_DATABASE_PATH: path, SIGHTGLASS_API_KEY: "test-key", SIGHTGLASS_DASHBOARD_PATH: join(directory, "no-dashboard"), SIGHTGLASS_INSECURE_HTTP: "true", SIGHTGLASS_SECRET: "test-secret" }, stdio: "ignore" });
  for (let attempt = 0; attempt < 200; attempt += 1) { try { if ((await fetch(`${origin}/healthz`)).ok) return; } catch { /* server is starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error("Sightglass test server did not start");
}, 15_000);

beforeAll(async () => { const response = await fetch(`${origin}/api/v1/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "test-setup-token", email: "admin@example.com", password: "a-strong-test-password" }) }); expect(response.status).toBe(201); cookie = response.headers.get("set-cookie")?.split(";")[0] ?? ""; csrf = String((await response.json() as { csrfToken: string }).csrfToken); }, 15_000);

afterAll(async () => { if (processHandle && !processHandle.killed) await new Promise<void>((resolve) => { processHandle.once("exit", () => resolve()); processHandle.kill(); }); rmSync(directory, { recursive: true, force: true }); });

describe("HTTP server", () => {
  it("serves health and protects ingestion", async () => {
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({ status: "ok" });
    expect((await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ protocol: 1, occurrences: [], meters: [], health: [] }) })).status).toBe(401);
    expect((await fetch(`${origin}/api/v1/summary`)).status).toBe(401);
  });

  it("validates and accepts authenticated versioned batches", async () => {
    const accepted = await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: JSON.stringify({ protocol: 1, occurrences: [], meters: [], health: [] }) });
    expect(accepted.status).toBe(202); expect(await accepted.json()).toEqual({ accepted: { occurrences: 0, meters: 0, health: 0 } });
    const invalid = await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: JSON.stringify({ protocol: 9, occurrences: [], meters: [], health: [] }) });
    expect(invalid.status).toBe(400); expect(Array.isArray(await (await fetch(`${origin}/api/v1/summary`, { headers: { cookie } })).json())).toBe(true);
    expect(Array.isArray(await (await fetch(`${origin}/api/v1/trend?service=missing&environment=test`, { headers: { cookie } })).json())).toBe(true);
    expect(Array.isArray(await (await fetch(`${origin}/api/v1/usage/trend?service=missing`, { headers: { cookie } })).json())).toBe(true);
  });

  it("enforces CSRF and supports one-time-visible named ingestion keys", async () => {
    const rejected = await fetch(`${origin}/api/v1/admin/ingestion-keys`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "test" }) });
    expect(rejected.status).toBe(403);
    const created = await fetch(`${origin}/api/v1/admin/ingestion-keys`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ name: "test" }) });
    expect(created.status).toBe(201); const key = String((await created.json() as { key: string }).key); expect(key).toMatch(/^sg_/);
    const accepted = await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ protocol: 1, occurrences: [], meters: [], health: [] }) });
    expect(accepted.status).toBe(202);
  });
});

function availablePort(): Promise<number> { return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return reject(new Error("No test port")); server.close(() => resolve(address.port)); }); }); }
