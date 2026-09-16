# @bazokhan/sightglass-nest

Opt-in Sightglass decorators and lifecycle support for NestJS.

```ts
import { Observe } from "@bazokhan/sightglass-nest";

@Observe("invoices.create")
createInvoice() {}
```

See the [NestJS guide](https://sightglass-docs.trugraph.io/docs/frameworks#nestjs).
