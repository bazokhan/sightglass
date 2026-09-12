# @bazokhan/sightglass-express

Explicit Sightglass instrumentation for Express and tsoa applications.

```ts
import { observe } from "@bazokhan/sightglass-express";

app.post("/invoices", observe("invoices.create"), createInvoice);
```

Install `@bazokhan/sightglass-core` and configure it once at application startup. See the [Express guide](https://sightglass-docs.vercel.app/docs/frameworks#express).
