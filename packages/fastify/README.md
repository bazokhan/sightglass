# @bazokhan/sightglass-fastify

Sightglass lifecycle integration and explicit route instrumentation for Fastify.

```ts
import { observe, sightglass } from "@bazokhan/sightglass-fastify";

await app.register(sightglass, config);
app.post("/invoices", { handler: observe("invoices.create", createInvoice) });
```

See the [Fastify guide](https://sightglass-observability-without-noise.vercel.app/docs/frameworks#fastify).
