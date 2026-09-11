import { runObserved, setRequestStatus } from "@sightglass/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export function observe(name?: string): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const operation = name ?? `${request.method} ${request.route?.path ?? request.path}`;
    const requestInfo = { method: request.method, route: String(request.route?.path ?? request.path), statusCode: 0 };
    const incomingTrace = request.header("traceparent");
    void runObserved(operation, { request: requestInfo, ...(incomingTrace ? { traceparent: incomingTrace } : {}) }, () => new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        requestInfo.statusCode = response.statusCode;
        setRequestStatus(response.statusCode);
        if (response.statusCode >= 500) reject(new Error(`HTTP ${response.statusCode}`));
        else resolve();
      };
      response.once("finish", finish);
      response.once("close", finish);
      next();
    })).catch(() => { /* the host response already owns error handling */ });
  };
}

export function Observe(name?: string): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = function (this: unknown, ...args: unknown[]) {
      return runObserved(name ?? String(propertyKey), {}, () => original.apply(this, args));
    };
  };
}
