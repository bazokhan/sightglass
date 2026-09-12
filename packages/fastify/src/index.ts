import type { FastifyPluginAsync, RouteHandlerMethod } from "fastify";
import { configureSightglass, runObserved, setRequestStatus, shutdownSightglass } from "@bazokhan/sightglass-core";
import type { SightglassConfig } from "@bazokhan/sightglass-core";

export function sightglass(config: SightglassConfig): FastifyPluginAsync {
  return async (instance) => {
    configureSightglass(config);
    instance.addHook("onClose", async () => { await shutdownSightglass(); });
  };
}

export function observe(name: string, handler: RouteHandlerMethod): RouteHandlerMethod {
  return async function (request, reply) {
    const incoming = request.headers.traceparent;
    const traceparent = Array.isArray(incoming) ? incoming[0] : incoming;
    const route = request.routeOptions.url ?? request.url;
    return runObserved(name, {
      request: { method: request.method, route, statusCode: reply.statusCode },
      ...(traceparent ? { traceparent } : {}),
    }, async () => {
      try {
        const result = await handler.call(this, request, reply);
        setRequestStatus(reply.statusCode);
        return result;
      } catch (error) {
        setRequestStatus(reply.statusCode >= 400 ? reply.statusCode : 500);
        throw error;
      }
    });
  };
}
