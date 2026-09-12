# @sightglass/express

Explicit Sightglass instrumentation for Express and tsoa applications.

```ts
import { observe } from "@sightglass/express";

app.post("/invoices", observe("invoices.create"), createInvoice);
```

Install `@sightglass/core` and configure it once at application startup. See the [Express guide](https://sightglass-observability-without-noise.vercel.app/docs/frameworks#express).

