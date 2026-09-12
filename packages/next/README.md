# @bazokhan/sightglass-next

Explicit Sightglass instrumentation for Next.js route handlers.

```ts
import { observe } from "@bazokhan/sightglass-next";

export const POST = observe("invoices.create", async (request) => {
  return Response.json({ ok: true });
});
```

See the [Next.js guide](https://sightglass-observability-without-noise.vercel.app/docs/frameworks#nextjs).
