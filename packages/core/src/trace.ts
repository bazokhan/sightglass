import { randomBytes } from "node:crypto";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export function createTrace(parent?: string): { traceId: string; spanId: string; parentId?: string } {
  const match = parent?.trim().match(TRACEPARENT);
  const spanId = randomBytes(8).toString("hex");
  if (match && match[1] !== "0".repeat(32) && match[2] !== "0".repeat(16)) {
    return { traceId: match[1]!.toLowerCase(), spanId, parentId: match[2]!.toLowerCase() };
  }
  return { traceId: randomBytes(16).toString("hex"), spanId };
}

export function traceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}
