import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HealthSample, IngestEnvelope, Occurrence, SightglassConfig, UsageEvent } from "./types.js";

export class Transport {
  private readonly occurrences: Occurrence[] = [];
  private readonly meters = new Map<string, UsageEvent>();
  private readonly health: HealthSample[] = [];
  private timer?: NodeJS.Timeout;
  private sending = false;

  constructor(private config: Required<Pick<SightglassConfig, "endpoint" | "batchSize" | "flushIntervalMs" | "maxQueueSize" | "requestTimeoutMs">> & SightglassConfig) {
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

  async flush(): Promise<void> {
    if (this.sending || (!this.occurrences.length && !this.meters.size && !this.health.length)) return;
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
    } catch {
      this.occurrences.unshift(...occurrences);
      if (this.occurrences.length > this.config.maxQueueSize) {
        this.occurrences.splice(0, this.occurrences.length - this.config.maxQueueSize);
      }
      this.health.unshift(...health);
    } finally {
      this.sending = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private spool(event: UsageEvent): void {
    if (!this.config.meterSpoolDirectory) return;
    try {
      mkdirSync(this.config.meterSpoolDirectory, { recursive: true });
      writeFileSync(join(this.config.meterSpoolDirectory, `${event.id}.json`), JSON.stringify(event), { flag: "wx", mode: 0o600 });
    } catch { /* host application must never fail because telemetry did */ }
  }

  private loadSpool(): void {
    if (!this.config.meterSpoolDirectory) return;
    try {
      mkdirSync(this.config.meterSpoolDirectory, { recursive: true });
      for (const file of readdirSync(this.config.meterSpoolDirectory).filter((name) => name.endsWith(".json")).slice(0, 10_000)) {
        const event = JSON.parse(readFileSync(join(this.config.meterSpoolDirectory, file), "utf8")) as UsageEvent;
        this.meters.set(event.id, event);
      }
    } catch { /* an unreadable spool degrades to in-memory delivery */ }
  }

  private removeSpool(id: string): void {
    if (!this.config.meterSpoolDirectory) return;
    try { unlinkSync(join(this.config.meterSpoolDirectory, `${id}.json`)); } catch { /* already removed */ }
  }
}
