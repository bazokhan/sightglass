# Build Sightglass

You are the principal engineer, product engineer, architect, QA engineer, DevOps engineer, and technical writer responsible for building **Sightglass** from an empty Git repository into a complete, usable, production-quality open-source product.

Work autonomously until the product is complete.

Do not stop after scaffolding.
Do not produce a prototype.
Do not produce an architecture proposal and wait for approval.
Do not split the work into phases that require my confirmation.
Do not ask me routine technical or product questions.

Make reasonable decisions yourself, implement them, test them, revise them when necessary, and continue.

Only ask me a question if you encounter a genuinely blocking ambiguity that cannot reasonably be resolved from this specification.

You have authority to:
- choose libraries;
- create the repository structure;
- install dependencies;
- create packages;
- create Docker configuration;
- design schemas;
- implement APIs;
- implement the dashboard;
- write tests;
- run tests;
- run builds;
- run Docker;
- inspect logs;
- benchmark;
- refactor;
- fix bugs;
- write documentation;
- create realistic example applications;
- make minor product decisions consistent with the doctrine below.

When implementation details are uncertain, research authoritative/current documentation if web access is available. Prefer boring, mature dependencies over unnecessary infrastructure.

Keep a persistent `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` inside the repository early in the project. They are your source of truth for subsequent work. Update them whenever important decisions change so that if your context is compacted or the session is interrupted, another agent can continue by reading the repository.

Also maintain `docs/STATUS.md` containing:
- what is complete;
- what remains;
- important decisions;
- commands to run the system;
- known issues.

Do not declare the project complete while `STATUS.md` contains unfinished core functionality.

---

# 1. PRODUCT

The product is called:

# Sightglass

The physical metaphor is a sight glass installed in machinery: a small deliberate window into the internal operation of a running system without opening, dismantling, or monitoring every part of it.

Sightglass is:

> **Application observability for developers who don't want an observability stack.**

The fundamental idea is:

> **Observe what matters, not everything that happens.**

Sightglass is intentionally opinionated, opt-in and lightweight.

Modern observability frequently begins by automatically instrumenting everything:

- every HTTP request;
- every static request;
- every span;
- every database call;
- every log;
- every metric;
- every runtime detail.

The developer then receives enormous quantities of telemetry and needs sophisticated storage, sampling, querying, dashboards and infrastructure merely to extract the few answers they actually care about.

Sightglass deliberately reverses this model.

**Nothing is observed by default.**

The developer explicitly identifies important application operations.

Examples:

- checkout;
- creating an order;
- generating a report;
- performing an AI generation;
- changing a subscription;
- processing a payment;
- important background jobs;
- important administrative actions.

Sightglass deeply observes those operations.

Everything else remains silent.

A million irrelevant profile reads, favicon requests, health requests, page renders or mundane successful endpoints should generate exactly zero Sightglass telemetry unless the developer explicitly chooses otherwise.

---

# 2. NON-NEGOTIABLE PRODUCT DOCTRINE

Preserve these principles throughout implementation.

## 2.1 Nothing is observed by default

Installing Sightglass must NOT suddenly collect the entire application.

Observation requires explicit developer intent.

## 2.2 The primary object is an Observed Operation

Do not design Sightglass primarily around the traditional:

- logs;
- metrics;
- traces.

Instead, Sightglass records an information-dense representation of one important execution:

**ObservedOperation / Occurrence**

From these records Sightglass derives debugging, performance and aggregate information.

## 2.3 Automatic instrumentation is allowed only inside an explicitly observed operation

Once an operation is active, Sightglass may automatically enrich it with obvious technical context.

For example:

- duration;
- result;
- HTTP status;
- exception;
- Prisma operations;
- database timing;
- outbound HTTP calls;
- downstream Sightglass-enabled services;
- useful runtime context.

Outside an active observed operation, instrumentation should be effectively silent.

This principle is extremely important.

## 2.4 Meaningful events, not noisy logs

Sightglass is NOT a log management system.

Applications may continue using console/Pino/Winston/etc.

Sightglass only records explicit meaningful events such as:

```ts
observe.event("payment.declined", {
  reason: "insufficient_funds"
});
```

Do not build another log warehouse.

## 2.5 Business context is explicit

The application knows things infrastructure cannot infer:

- tenant;
- customer;
- plan;
- feature;
- business IDs.

The developer can attach these explicitly.

## 2.6 Usage is first-class

Sightglass should answer:

- which customer uses this feature?
- how much?
- how often?
- which APIs/features consume quota?
- what exact usage occurred?

Usage metering must be durable enough to support downstream invoicing.

However:

> **Sightglass provides billing-grade usage metering, not billing.**

Do NOT build subscriptions, prices, invoices, tax calculation, payment processing, etc.

## 2.7 Infrastructure is context, not a product

Provide only basic information useful when debugging application behavior:

- CPU;
- memory;
- disk;
- uptime;
- process restart count where feasible;
- Node event-loop lag.

Do NOT build infrastructure observability.

## 2.8 One lightweight deployment

The default deployment goal is:

```text
Applications
     │
     ▼
 Sightglass
     │
     ▼
one local data volume
```

Sightglass should ideally run as:

- one process;
- one Docker container;
- one exposed port;
- one persistent volume.

Do NOT require:

- Kafka;
- Redis;
- PostgreSQL;
- ClickHouse;
- Prometheus;
- Grafana;
- Loki;
- Tempo;
- Elasticsearch;
- OpenTelemetry Collector;
- multiple microservices.

Complex infrastructure defeats the product.

## 2.9 Opinionated UI

Sightglass has ONE dashboard.

Do not implement:

- dashboard builders;
- custom widgets;
- arbitrary visualization creation;
- PromQL;
- TraceQL;
- LogQL;
- generic SQL consoles;
- generic telemetry explorers.

Sightglass already knows the questions it intends to answer.

## 2.10 Power users can use something else

Sightglass intentionally does not compete feature-for-feature with Datadog, Grafana, Honeycomb, SigNoz, Sentry, etc.

Do not respond to missing functionality by gradually recreating those products.

---

# 3. SUPPORTED ECOSYSTEM

Only support:

- Node.js;
- TypeScript;
- NestJS;
- Express;
- tsoa running on Express;
- Next.js;
- Prisma;
- native Node `fetch` / compatible outbound HTTP where practical.

Do NOT spend time building language-neutral abstractions for hypothetical Python, Java, Go, .NET, etc.

Optimize aggressively for the supported ecosystem.

A beautiful NestJS integration is more important than theoretical language neutrality.

---

# 4. REPOSITORY

Use a clean TypeScript monorepo.

Choose an appropriate modern monorepo/package manager setup.

A likely shape is:

```text
/
  apps/
    server/
    dashboard/
    examples/

  packages/
    core/
    nest/
    express/
    next/
    prisma/          # only if separation is useful

  docs/

  docker/

  package.json
  README.md
```

You may improve this structure if another organization is cleaner.

Do not create packages merely for architectural purity.

Prefer fewer packages.

The dashboard and backend may ultimately be compiled/packaged into the same production container.

---

# 5. DEVELOPER API

The public API must remain extremely small.

Developers should conceptually learn only:

```ts
observe()
observe.set()
observe.event()
observe.meter()
observe.step()
```

Framework-specific decorators/wrappers may provide the first primitive.

Do NOT expose low-level telemetry concepts unless absolutely necessary.

---

# 6. NESTJS EXPERIENCE

Target setup:

```ts
@Module({
  imports: [
    SightglassModule.forRoot({
      service: "billing-api",
      endpoint: "http://sightglass:7777"
    })
  ]
})
export class AppModule {}
```

Then:

```ts
@Observe()
@Post("checkout")
async checkout() {
  ...
}
```

Support controller-level observation:

```ts
@Observe()
@Controller("billing")
export class BillingController {}
```

And exclusion where useful:

```ts
@NoObserve()
@Get("something-unimportant")
...
```

Implement this using appropriate Nest metadata/interceptor/context mechanisms.

The developer should not manually create traces/spans.

---

# 7. EXPRESS EXPERIENCE

Target:

```ts
app.post(
  "/checkout",
  observe(),
  checkoutHandler
);
```

Allow semantic naming:

```ts
app.post(
  "/checkout",
  observe("checkout"),
  checkoutHandler
);
```

Keep it idiomatic Express middleware.

---

# 8. TSOA EXPERIENCE

Aim for:

```ts
@Observe()
@Post("checkout")
public async checkout() {
  ...
}
```

Reuse the Express implementation underneath where practical.

Do not create a second observability engine for tsoa.

Document whatever one-time integration is necessary.

---

# 9. NEXT.JS EXPERIENCE

Prioritize server-side behavior, especially App Router Route Handlers.

Example:

```ts
export const POST = observe(
  "checkout",
  async request => {
    ...
  }
);
```

Use `instrumentation.ts` only if necessary for initializing supported runtime hooks.

Do NOT automatically observe:

- page rendering;
- RSC requests;
- favicon;
- static assets;
- prefetch;
- CSS;
- arbitrary browser activity.

Next.js frontend/product analytics is NOT Sightglass's purpose.

Support server actions only if it can be done reliably without compromising the core implementation. Otherwise document it as unsupported rather than shipping unreliable magic.

---

# 10. OPERATION CONTEXT

Use Node's `AsyncLocalStorage` or the best current equivalent to maintain the active operation through asynchronous execution.

Developers must NOT pass Sightglass context manually through their application.

Within an active operation this should work anywhere downstream:

```ts
observe.set(...)
observe.event(...)
observe.meter(...)
observe.step(...)
```

Nested async functions, services and repositories should retain context.

Write serious tests for this.

---

# 11. OBSERVED OPERATION MODEL

An occurrence should conceptually contain:

```ts
interface Occurrence {
  id: string;
  operation: string;

  startedAt: string;
  durationMs: number;

  status: "success" | "error";

  service: string;
  environment: string;

  request?: {
    method: string;
    route: string;
    statusCode: number;
  };

  context: Record<string, Primitive>;

  error?: {
    type: string;
    message: string;
    stack?: string;
  };

  database?: {
    queryCount: number;
    totalDurationMs: number;
    operations: DatabaseOperation[];
  };

  dependencies?: DependencyOperation[];

  events?: SemanticEvent[];

  steps?: Step[];

  usage?: UsageReference[];

  runtime?: RuntimeSnapshot;

  distributed?: {
    traceId: string;
    parentId?: string;
  };
}
```

This is illustrative rather than mandatory.

Design the real schema carefully.

Keep records compact.

---

# 12. CONTEXT API

Example:

```ts
observe.set({
  tenantId: "tenant_123",
  userId: "user_91",
  plan: "pro"
});
```

Allow only small primitive searchable values:

- string;
- number;
- boolean;
- null where sensible.

Do NOT accept giant nested arbitrary objects.

Implement sane limits, for example:

- maximum attributes;
- maximum key length;
- maximum string value length.

Choose reasonable values and document them.

Prevent accidental telemetry explosions.

---

# 13. EVENTS

Example:

```ts
observe.event("inventory.shortage", {
  sku: "ABC",
  requested: 10,
  available: 3
});
```

Events represent meaningful application occurrences.

They are NOT:

```text
entered function
debug here
starting loop
value = ...
```

Events should appear naturally inside the occurrence timeline.

Apply similar small-data limits to event attributes.

---

# 14. STEPS

Provide:

```ts
await observe.step("calculate-price", async () => {
  ...
});
```

Measure duration and success/error.

Steps should be used for meaningful manually identified child work.

Do not require developers to manually wrap things Sightglass can already reliably capture, such as supported Prisma/outbound HTTP operations.

---

# 15. PRISMA

Prisma is first-class.

Inside an active observed operation, collect useful database information such as:

- Prisma model;
- operation/action;
- duration;
- query count;
- total DB duration;
- slowest DB operations.

The dashboard should answer:

- which DB operations are slow?
- which operations call them?
- how much of operation duration is DB work?
- which query consumes the most aggregate time?

Do NOT capture sensitive bind parameters by default.

Avoid storing request/customer secrets.

Prefer normalized semantic descriptions such as:

```text
Order.findMany
Inventory.update
User.findUnique
```

rather than dumping sensitive SQL.

If modern Prisma APIs affect implementation strategy, research the current supported instrumentation APIs rather than relying on obsolete middleware APIs.

---

# 16. OUTBOUND HTTP

Inside an observed operation, automatically capture supported outbound HTTP/fetch calls.

Record useful information such as:

- destination host/service;
- method;
- normalized path if safe;
- duration;
- status;
- error.

Do NOT store authorization headers or request/response bodies.

Propagate distributed operation identity downstream.

Prefer established W3C Trace Context (`traceparent`) semantics rather than inventing an incompatible distributed correlation protocol.

You may implement only the subset required by Sightglass.

Sightglass does NOT need to become an OpenTelemetry implementation.

---

# 17. DISTRIBUTED OPERATIONS

Example:

```text
checkout                     842ms ERROR
├─ inventory.reserve         102ms
│  └─ Prisma Inventory.update 61ms
└─ payment.authorize         493ms
   └─ payment-provider       421ms
```

If an observed operation in service A calls another Sightglass-enabled service, correlate the work.

The downstream service should contribute to the same distributed occurrence when appropriate.

Be thoughtful about the semantics of:

- explicitly observed downstream routes;
- propagated observation intent;
- nested operations;
- parent/child IDs;
- failures;
- missing downstream Sightglass installation.

The philosophy remains:

**propagation may travel broadly, but storage happens only when observation has been intentionally activated.**

Do not accidentally turn propagation into automatic global collection.

---

# 18. ERRORS

When an observed operation throws, capture useful diagnostic information:

- exception type;
- message;
- sanitized stack;
- failing step/dependency where identifiable.

Never collect errors from unobserved application activity merely because they happened.

Sightglass is not Sentry.

---

# 19. USAGE METERING

Provide:

```ts
observe.meter("ai.tokens", 1842);
observe.meter("pdf.exports", 1);
observe.meter("sms.sent", 1);
```

Metering is fundamentally more reliable than ordinary observability telemetry.

Design the usage path around:

- durable persistence;
- idempotency;
- unique event IDs;
- retries;
- deduplication;
- tenant/customer identity;
- timestamp;
- meter;
- quantity.

A reasonable configuration API may define meters centrally.

Example:

```ts
meters: {
  "ai.tokens": { unit: "tokens" },
  "pdf.exports": { unit: "export" },
  "sms.sent": { unit: "message" }
}
```

Do not overengineer pricing.

Sightglass reports exact usage.

External systems can invoice from it later.

Design export capability so exact usage can reasonably be exported as CSV/JSON/API and later integrated with systems such as Stripe, Metronome or OpenMeter.

Do NOT implement those integrations unless they are trivial and do not distract from the product.

---

# 20. INGESTION / TRANSPORT

The SDK should send occurrences to the Sightglass server efficiently.

Requirements:

- asynchronous;
- batched where appropriate;
- should not materially delay application requests;
- bounded memory;
- retry sensible transient failures;
- application should continue functioning if Sightglass is unavailable;
- telemetry failure must not crash the host application.

Usage-meter events require stronger delivery guarantees than ordinary occurrence telemetry.

Design accordingly.

A simple HTTP protocol is strongly preferred unless another solution demonstrably provides significant benefit.

Do not introduce message brokers.

Document the protocol.

Version it.

Validate incoming payloads.

Protect against oversized payloads.

---

# 21. STORAGE

The default server should use an embedded database.

Prefer **SQLite** unless real benchmarking demonstrates that another embedded solution is materially better.

Use:

- WAL where appropriate;
- proper indexes;
- bounded transactions;
- batching;
- migrations.

Do not prematurely introduce ClickHouse.

Design around the fact that Sightglass intentionally stores dramatically less telemetry than traditional APM.

---

# 22. DATA CLASSES

Internally reason around only three important data categories:

## Occurrence

One observed execution.

Used for debugging.

## Aggregate

Precomputed/periodic statistics derived from occurrences.

Used for long-term monitoring/dashboard performance.

## Meter

Durable exact usage ledger.

Used for business usage and downstream billing.

Do not recreate separate trace/log/metric databases.

---

# 23. RETENTION

Default imagined retention:

```text
successful raw occurrences     7 days
error occurrences             30 days
hourly aggregates             12 months
meter ledger                  indefinite
```

Make these configurable without creating a configuration jungle.

Implement background retention cleanup.

Long-term trends should rely on aggregates rather than retaining all raw operations forever.

---

# 24. AGGREGATION

Maintain useful aggregate statistics so dashboard requests don't repeatedly scan every occurrence.

Support at least:

- operation call count;
- errors;
- error rate;
- latency distribution / p50 / p95 / p99;
- DB total/average contribution;
- dependency timing;
- unauthorized counts;
- meter totals;
- service health history.

Choose a compact method for percentile calculation appropriate for the expected scale.

Do not introduce a metrics database.

---

# 25. BASIC HEALTH COLLECTION

Collect only contextual health data useful to application developers:

Per service/process where possible:

- CPU;
- process memory;
- event-loop lag;
- uptime;
- restart indication/count if reasonably inferable.

Host:

- disk usage;
- perhaps memory/CPU where safe and portable.

Sample at a low frequency such as 30–60 seconds.

Do not collect hundreds of host metrics.

Do not build infrastructure topology.

Docker/cgroup awareness may be added if simple and reliable.

---