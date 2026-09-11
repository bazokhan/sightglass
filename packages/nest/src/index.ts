import { CallHandler, DynamicModule, ExecutionContext, Injectable, Module, NestInterceptor, SetMetadata } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { configureSightglass, runObserved, setRequestStatus } from "@sightglass/core";
import type { SightglassConfig } from "@sightglass/core";
import { Observable, defer, from, lastValueFrom } from "rxjs";

const OBSERVE = Symbol("sightglass.observe");
const NO_OBSERVE = Symbol("sightglass.no-observe");

export const Observe = (name?: string): ClassDecorator & MethodDecorator => SetMetadata(OBSERVE, name ?? true);
export const NoObserve = (): MethodDecorator => SetMetadata(NO_OBSERVE, true);

@Injectable()
export class SightglassInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const controller = context.getClass();
    if (Reflect.getMetadata(NO_OBSERVE, handler)) return next.handle();
    const metadata = Reflect.getMetadata(OBSERVE, handler) ?? Reflect.getMetadata(OBSERVE, controller);
    if (!metadata) return next.handle();
    const request = context.switchToHttp().getRequest<{ method: string; route?: { path?: string }; url: string; headers: Record<string, string | undefined> }>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    const operation = typeof metadata === "string" ? metadata : `${controller.name}.${handler.name}`;
    const incomingTrace = request.headers.traceparent;
    return defer(() => from(runObserved(operation, {
      request: { method: request.method, route: request.route?.path ?? request.url, statusCode: response.statusCode },
      ...(incomingTrace ? { traceparent: incomingTrace } : {}),
    }, async () => { const value = await lastValueFrom(next.handle()); setRequestStatus(response.statusCode); return value; })));
  }
}

@Module({})
export class SightglassModule {
  static forRoot(config: SightglassConfig): DynamicModule {
    configureSightglass(config);
    return { module: SightglassModule, providers: [SightglassInterceptor, { provide: APP_INTERCEPTOR, useExisting: SightglassInterceptor }], exports: [SightglassInterceptor] };
  }
}
