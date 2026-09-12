import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let processHandle: ChildProcess; let origin: string; let directory: string;

beforeAll(async () => {
  const port = await availablePort(); origin = `http://127.0.0.1:${port}`; directory = mkdtempSync(join(tmpdir(), "sightglass-http-"));
  processHandle = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], { cwd: process.cwd(), env: { ...process.env, SIGHTGLASS_PORT: String(port), SIGHTGLASS_DATABASE_PATH: join(directory, "test.sqlite"), SIGHTGLASS_API_KEY: "test-key", SIGHTGLASS_DASHBOARD_PATH: join(directory, "no-dashboard") }, stdio: "ignore" });
  for (let attempt = 0; attempt < 50; attempt += 1) { try { if ((await fetch(`${origin}/healthz`)).ok) return; } catch { /* server is starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error("Sightglass test server did not start");
});

afterAll(async () => { if (processHandle && !processHandle.killed) await new Promise<void>((resolve) => { processHandle.once("exit", () => resolve()); processHandle.kill(); }); rmSync(directory, { recursive: true, force: true }); });

describe("HTTP server", () => {
  it("serves health and protects ingestion", async () => {
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({ status: "ok" });
    expect((await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ protocol: 1, occurrences: [], meters: [], health: [] }) })).status).toBe(401);
  });

  it("validates and accepts authenticated versioned batches", async () => {
    const accepted = await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: JSON.stringify({ protocol: 1, occurrences: [], meters: [], health: [] }) });
    expect(accepted.status).toBe(202); expect(await accepted.json()).toEqual({ accepted: { occurrences: 0, meters: 0, health: 0 } });
    const invalid = await fetch(`${origin}/api/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: JSON.stringify({ protocol: 9, occurrences: [], meters: [], health: [] }) });
    expect(invalid.status).toBe(400); expect(Array.isArray(await (await fetch(`${origin}/api/v1/summary`)).json())).toBe(true);
    expect(Array.isArray(await (await fetch(`${origin}/api/v1/trend?service=missing&environment=test`)).json())).toBe(true);
    expect(Array.isArray(await (await fetch(`${origin}/api/v1/usage/trend?service=missing`)).json())).toBe(true);
  });
});

function availablePort(): Promise<number> { return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return reject(new Error("No test port")); server.close(() => resolve(address.port)); }); }); }
