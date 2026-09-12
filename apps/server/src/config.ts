import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const config = Object.freeze({
  port: positiveInteger("SIGHTGLASS_PORT", 7777),
  databasePath: process.env.SIGHTGLASS_DATABASE_PATH
    ? resolve(process.env.SIGHTGLASS_DATABASE_PATH)
    : fileURLToPath(new URL("../../../data/sightglass.db", import.meta.url)),
  dashboardPath: process.env.SIGHTGLASS_DASHBOARD_PATH
    ? resolve(process.env.SIGHTGLASS_DASHBOARD_PATH)
    : fileURLToPath(new URL("../../dashboard/dist", import.meta.url)),
  apiKey: process.env.SIGHTGLASS_API_KEY,
  successRetentionDays: positiveInteger("SIGHTGLASS_SUCCESS_RETENTION_DAYS", 7),
  errorRetentionDays: positiveInteger("SIGHTGLASS_ERROR_RETENTION_DAYS", 30),
  aggregateRetentionDays: positiveInteger("SIGHTGLASS_AGGREGATE_RETENTION_DAYS", 365),
});
