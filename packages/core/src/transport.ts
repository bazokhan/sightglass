import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HealthSample, IngestEnvelope, Occurrence, SightglassConfig, UsageEvent } from "./types.js";

export class Transport {
  private readonly occurrences: Occurrence[] = [];
  private readonly meters = new Map<string, UsageEvent>();
  private readonly health: HealthSample[] = [];
  private timer?: NodeJS.Timeout;
  private sending = false;
  private retryAttempt = 0;
  private nextRetryAt = 0;

  constructor(private config: Required<Pick<SightglassConfig, "endpoint" | "batchSize" | "flushIntervalMs" | "maxQueueSize" | "requestTimeoutMs" | "retryBaseMs" | "retryMaxMs">> & SightglassConfig) {
    this.loadSpool();
    this.timer = setInterval(() => void this.flush(), config.flushIntervalMs);
    this.timer.unref();
  }

  enqueueOccurrence(value: Occurrence): void {
    if (this.occurrences.length >= this.config.maxQueueSize) this.occurrences.shift();
    this.occurrences.push(value);
    if (this.occurrences.length >= this.config.batchSize) void this.flush();
  }

  enqueueMeter(value: UsageEvent): void {
    this.meters.set(value.id, value);
    this.spool(value);
    if (this.meters.size >= this.config.batchSize) void this.flush();
  }

  enqueueHealth(value: HealthSample): void {
    if (this.health.length >= 10) this.health.shift();
    this.health.push(value);
    void this.flush();
  }

  async flush(force = false): Promise<void> {
    if (this.sending || (!force && Date.now() < this.nextRetryAt) || (!this.occurrences.length && !this.meters.size && !this.health.length)) return;
    this.sending = true;
    const occurrences = this.occurrences.splice(0, this.config.batchSize);
    const meters = [...this.meters.values()].slice(0, this.config.batchSize);
    const health = this.health.splice(0, this.config.batchSize);
    const payload: IngestEnvelope = { protocol: 1, occurrences, meters, health };
    try {
      const response = await fetch(`${this.config.endpoint.replace(/\/$/, "")}/api/v1/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`ingest returned ${response.status}`);
      for (const meter of meters) {
        this.meters.delete(meter.id);
        this.removeSpool(meter.id);
      }
      this.retryAttempt = 0;
      this.nextRetryAt = 0;
    } catch {
      this.occurrences.unshift(...occurrences);
      if (this.occurrences.length > this.config.maxQueueSize) {
        this.occurrences.splice(0, this.occurrences.length - this.config.maxQueueSize);
      }
      this.health.unshift(...health);
      this.retryAttempt += 1;
      const ceiling = Math.min(this.config.retryMaxMs, this.config.retryBaseMs * 2 ** (this.retryAttempt - 1));
      this.nextRetryAt = Date.now() + Math.round(ceiling * (0.75 + Math.random() * 0.5));
    } finally {
      this.sending = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    while (this.sending) await new Promise((resolve) => setTimeout(resolve, 5));
    while (this.occurrences.length || this.meters.size || this.health.length) {
      await this.flush(true);
      if (this.nextRetryAt) break;
    }
  }

  private spool(event: UsageEvent): void {
    if (!this.config.meterSpoolDirectory) return;
    const finalPath = join(this.config.meterSpoolDirectory, `${event.id}.json`);
    const temporaryPath = join(this.config.meterSpoolDirectory, `${event.id}.${process.pid}.tmp`);
    let descriptor: number | undefined;
    try {
      mkdirSync(this.config.meterSpoolDirectory, { recursive: true });
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(event));
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      renameSync(temporaryPath, finalPath);
    } catch {
      if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* already closed */ }
      try { unlinkSync(temporaryPath); } catch { /* no partial file */ }
      /* host application must never fail because telemetry did */
    }
  }

  private loadSpool(): void {
    if (!this.config.meterSpoolDirectory) return;
    try {
      mkdirSync(this.config.meterSpoolDirectory, { recursive: true });
      for (const file of readdirSync(this.config.meterSpoolDirectory).filter((name) => name.endsWith(".json")).slice(0, 10_000)) {
        try {
          const event = JSON.parse(readFileSync(join(this.config.meterSpoolDirectory, file), "utf8")) as UsageEvent;
          if (event.id && event.id === file.slice(0, -5)) this.meters.set(event.id, event);
        } catch { /* one corrupt entry must not block recovery of valid entries */ }
      }
    } catch { /* an unreadable spool degrades to in-memory delivery */ }
  }

  private removeSpool(id: string): void {
    if (!this.config.meterSpoolDirectory) return;
    try { unlinkSync(join(this.config.meterSpoolDirectory, `${id}.json`)); } catch { /* already removed */ }
  }
}
