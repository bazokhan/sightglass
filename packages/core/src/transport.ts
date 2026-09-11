import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, opendirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

  enqueueMeter(value: UsageEvent): boolean {
    const durable = this.spool(value);
    if (this.meters.size < this.config.maxQueueSize || this.meters.has(value.id)) this.meters.set(value.id, value);
    else if (!durable) {
      this.report(new Error("meter queue is full and durable spool is unavailable"), "meter-spool");
      return false;
    }
    if (this.meters.size >= this.config.batchSize) void this.flush();
    return true;
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
      this.loadSpool();
      this.retryAttempt = 0;
      this.nextRetryAt = 0;
    } catch (error) {
      this.occurrences.unshift(...occurrences);
      if (this.occurrences.length > this.config.maxQueueSize) {
        this.occurrences.splice(0, this.occurrences.length - this.config.maxQueueSize);
      }
      this.health.unshift(...health);
      this.retryAttempt += 1;
      const ceiling = Math.min(this.config.retryMaxMs, this.config.retryBaseMs * 2 ** (this.retryAttempt - 1));
      this.nextRetryAt = Date.now() + Math.round(ceiling * (0.75 + Math.random() * 0.5));
      this.report(error instanceof Error ? error : new Error(String(error)), "transport");
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

  private spool(event: UsageEvent): boolean {
    if (!this.config.meterSpoolDirectory) return false;
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
      return true;
    } catch (error) {
      if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* already closed */ }
      try { unlinkSync(temporaryPath); } catch { /* no partial file */ }
      if (existsSync(finalPath)) return true;
      this.report(error instanceof Error ? error : new Error(String(error)), "meter-spool");
      return false;
    }
  }

  private loadSpool(): void {
    if (!this.config.meterSpoolDirectory) return;
    try {
      mkdirSync(this.config.meterSpoolDirectory, { recursive: true });
      const directory = opendirSync(this.config.meterSpoolDirectory);
      try {
        for (let entry = directory.readSync(); entry && this.meters.size < this.config.maxQueueSize; entry = directory.readSync()) {
          const file = entry.name;
          if (!entry.isFile() || !file.endsWith(".json")) continue;
          try {
            const event = JSON.parse(readFileSync(join(this.config.meterSpoolDirectory, file), "utf8")) as UsageEvent;
            if (event.id && event.id === file.slice(0, -5) && !this.meters.has(event.id)) this.meters.set(event.id, event);
          } catch (error) { this.report(error instanceof Error ? error : new Error(String(error)), "meter-spool"); }
        }
      } finally { directory.closeSync(); }
    } catch { /* an unreadable spool degrades to in-memory delivery */ }
  }

  private removeSpool(id: string): void {
    if (!this.config.meterSpoolDirectory) return;
    try { unlinkSync(join(this.config.meterSpoolDirectory, `${id}.json`)); } catch { /* already removed */ }
  }

  private report(error: Error, area: "transport" | "meter-spool"): void {
    try { this.config.onTelemetryError?.(error, area); } catch { /* diagnostics must not affect the host */ }
  }
}
