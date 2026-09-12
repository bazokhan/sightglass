import express from "express";
import { configureSightglass, observe as sightglass, shutdownSightglass } from "@sightglass/core";
import { observe } from "@sightglass/express";

configureSightglass({ service: "example-shop", endpoint: process.env.SIGHTGLASS_ENDPOINT ?? "http://localhost:7777", meters: { "orders.created": { unit: "order" } } });
const app = express();
app.use(express.json());

app.post("/checkout", observe("checkout"), async (request, response) => {
  const tenantId = String(request.body?.tenantId ?? "demo-tenant");
  sightglass.set({ tenantId, plan: "pro" });
  await sightglass.step("calculate-total", async () => new Promise((resolve) => setTimeout(resolve, 35)));
  sightglass.event("payment.authorized", { provider: "example-pay" });
  sightglass.meter("orders.created", 1, { tenantId });
  response.status(201).json({ orderId: crypto.randomUUID() });
});

app.get("/health", (_request, response) => response.json({ ok: true }));
const server = app.listen(3000, () => console.log("Example shop listening on http://localhost:3000"));
const stop = () => server.close(() => { void shutdownSightglass().finally(() => process.exit(0)); });
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
