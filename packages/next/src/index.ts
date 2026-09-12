import { normalizePath, runObserved, setRequestStatus } from "@bazokhan/sightglass-core";

type RouteHandler<TContext = unknown> = (request: Request, context: TContext) => Response | Promise<Response>;

export function observe<TContext = unknown>(name: string, handler: RouteHandler<TContext>): RouteHandler<TContext> {
  return async (request, context) => { const incomingTrace = request.headers.get("traceparent") ?? undefined; return runObserved(name, {
    request: { method: request.method, route: normalizePath(new URL(request.url).pathname), statusCode: 0 },
    ...(incomingTrace ? { traceparent: incomingTrace } : {}),
  }, async () => {
    const response = await handler(request, context);
    setRequestStatus(response.status);
    return response;
  }); };
}
