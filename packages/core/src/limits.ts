import type { Attributes, Primitive } from "./types.js";

export const LIMITS = Object.freeze({
  attributes: 32,
  keyLength: 64,
  stringLength: 512,
  nameLength: 128,
  operationsPerCategory: 64,
  stackLength: 4096,
});

export function boundedName(value: string, label = "name"): string {
  const clean = value.trim();
  if (!clean) throw new TypeError(`Sightglass ${label} must not be empty`);
  return clean.slice(0, LIMITS.nameLength);
}

export function boundedAttributes(input: Attributes = {}): Attributes {
  const output: Attributes = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, LIMITS.attributes)) {
    const key = rawKey.trim().slice(0, LIMITS.keyLength);
    if (!key || !isPrimitive(rawValue)) continue;
    output[key] = typeof rawValue === "string" ? rawValue.slice(0, LIMITS.stringLength) : rawValue;
  }
  return output;
}

function isPrimitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

const uuidSegment = /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;
const longIdentifier = /\b(?:\d+|[0-9a-f]{16,})\b/gi;

export function normalizePath(pathname: string): string {
  return pathname.split("?")[0]!.replace(uuidSegment, ":id").replace(longIdentifier, ":id").slice(0, 512);
}
