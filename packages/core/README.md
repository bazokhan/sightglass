# @sightglass/core

Explicit, low-noise observability primitives for Node.js and TypeScript.

```ts
import { configureSightglass, observe } from "@sightglass/core";

configureSightglass({
  service: "billing-api",
  environment: "production",
  endpoint: "http://localhost:3333",
});

export const charge = observe("billing.charge", async (invoiceId: string) => {
  observe.set({ invoiceId });
  await observe.step("payment-provider", () => capturePayment(invoiceId));
  observe.event("invoice.charged");
});
```

Sightglass records only code paths you opt into. See the [quickstart](https://sightglass-observability-without-noise.vercel.app/docs/quickstart) and [API reference](https://sightglass-observability-without-noise.vercel.app/docs/api).

