import { useState } from "react";

type DocId = "start" | "concepts" | "express" | "nest" | "next" | "prisma" | "operate";

const pages: Array<{ id: DocId; label: string; eyebrow: string }> = [
  { id: "start", label: "Start here", eyebrow: "5 minute setup" },
  { id: "concepts", label: "Core API", eyebrow: "The five primitives" },
  { id: "express", label: "Express & tsoa", eyebrow: "Middleware" },
  { id: "nest", label: "NestJS", eyebrow: "Decorators" },
  { id: "next", label: "Next.js", eyebrow: "Route handlers" },
  { id: "prisma", label: "Prisma & fetch", eyebrow: "Automatic detail" },
  { id: "operate", label: "Run & configure", eyebrow: "Deployment" },
];

export function DocsView() {
  const [page, setPage] = useState<DocId>("start");
  return <div className="docs-layout">
    <nav className="docs-nav" aria-label="Documentation pages">
      <p>Documentation</p>
      {pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><span>{item.label}</span><small>{item.eyebrow}</small></button>)}
    </nav>
    <article className="docs-article">
      <DocPage page={page} />
    </article>
  </div>;
}

function DocPage({ page }: { page: DocId }) {
  if (page === "start") return <>
    <DocHeading kicker="Start here" title="See your first operation" summary="Run one container, connect an SDK, and explicitly choose the application work worth observing." />
    <NumberedStep number="01" title="Run Sightglass"><p>The server, SQLite database, API, and this dashboard ship together.</p><CodeBlock code={`docker compose up --build`} /></NumberedStep>
    <NumberedStep number="02" title="Configure your service"><p>Initialize once during application startup. Installing the SDK does not observe anything by itself.</p><CodeBlock code={`import { configureSightglass } from "@sightglass/core";

configureSightglass({
  service: "billing-api",
  endpoint: "http://localhost:7777",
  environment: "development"
});`} /></NumberedStep>
    <NumberedStep number="03" title="Choose one important operation"><p>Add an explicit framework wrapper. Exercise that route and return to Overview.</p><CodeBlock code={`app.post("/checkout", observe("checkout"), checkoutHandler);`} /></NumberedStep>
    <Callout title="Nothing is observed by default">Health checks, static files, ordinary routes, page renders, and background noise stay silent until you deliberately wrap them.</Callout>
  </>;

  if (page === "concepts") return <>
    <DocHeading kicker="Core API" title="Five things to learn" summary="Every framework adapter opens an operation context. These helpers work anywhere downstream without passing context through your code." />
    <ApiItem signature="observe()" description="Starts one explicitly observed operation. Framework middleware, decorators, and wrappers provide this primitive idiomatically." />
    <ApiItem signature="observe.set(attributes)" description="Attaches searchable business context such as tenant, user, plan, feature, or business IDs." code={`observe.set({ tenantId: "tenant_123", plan: "pro" });`} />
    <ApiItem signature="observe.event(name, attributes?)" description="Records a meaningful application event—not a debug log." code={`observe.event("payment.declined", {
  reason: "insufficient_funds"
});`} />
    <ApiItem signature="observe.meter(name, quantity, attributes?)" description="Creates an exact, idempotent usage-ledger entry for quota reporting or downstream invoicing." code={`observe.meter("ai.tokens", 1842, {
  tenantId: "tenant_123"
});`} />
    <ApiItem signature="observe.step(name, work)" description="Measures meaningful child work and records success or failure." code={`await observe.step("calculate-price", calculatePrice);`} />
    <Callout title="Built-in safety limits">Context and event attributes accept 32 primitive values. Keys are capped at 64 characters and strings at 512. Nested objects, bodies, headers, SQL parameters, and secrets are not accepted.</Callout>
  </>;

  if (page === "express") return <>
    <DocHeading kicker="Express & tsoa" title="Observe selected routes" summary="Use ordinary Express middleware. Semantic names remain stable when route paths change." />
    <h2>Express</h2><CodeBlock code={`import { observe } from "@sightglass/express";

app.post(
  "/checkout",
  observe("checkout"),
  checkoutHandler
);`} />
    <p>Place the middleware only on routes that matter. It captures method, normalized route, response status, duration, errors, active Prisma work, and outbound fetch calls.</p>
    <h2>tsoa</h2><CodeBlock code={`import { Observe } from "@sightglass/express";

@Observe("checkout")
@Post("checkout")
public async checkout() {
  // ...
}`} />
    <p>The method decorator uses the same engine. If you also need HTTP route and status metadata, attach the Express middleware to selected generated routes after <code>RegisterRoutes(app)</code>.</p>
  </>;

  if (page === "nest") return <>
    <DocHeading kicker="NestJS" title="One module, explicit decorators" summary="The module registers its interceptor globally. Controllers stay silent unless they carry @Observe()." />
    <h2>Configure the module</h2><CodeBlock code={`@Module({
  imports: [
    SightglassModule.forRoot({
      service: "billing-api",
      endpoint: "http://sightglass:7777"
    })
  ]
})
export class AppModule {}`} />
    <h2>Choose operations</h2><CodeBlock code={`@Observe("checkout")
@Post("checkout")
async checkout() {
  // ...
}`} />
    <p>Put <code>@Observe()</code> on a controller to observe all its handlers. Exclude an unimportant handler with <code>@NoObserve()</code>. Without either explicit choice, Sightglass remains silent.</p>
  </>;

  if (page === "next") return <>
    <DocHeading kicker="Next.js" title="Server route handlers only" summary="Wrap important App Router Route Handlers without turning frontend traffic into telemetry." />
    <CodeBlock code={`import { observe } from "@sightglass/next";

export const POST = observe(
  "checkout",
  async (request) => {
    return Response.json({ ok: true });
  }
);`} />
    <h2>What stays silent</h2>
    <ul><li>Page and React Server Component rendering</li><li>Static assets, CSS, favicon, prefetch, and arbitrary browser activity</li><li>Unwrapped Route Handlers</li></ul>
    <Callout title="Server Actions">Server Actions are intentionally unsupported. Their runtime behavior does not provide reliable route-level operation semantics; use an observed Route Handler for important server work.</Callout>
  </>;

  if (page === "prisma") return <>
    <DocHeading kicker="Automatic detail" title="Prisma and outbound fetch" summary="Once an operation is active, Sightglass safely enriches it with obvious technical context." />
    <h2>Prisma Client extension</h2><CodeBlock code={`import { PrismaClient } from "@prisma/client";
import { withSightglass } from "@sightglass/prisma";

const prisma = withSightglass(new PrismaClient());`} />
    <p>Queries become normalized names such as <code>Order.findMany</code> with duration and status. Sightglass never stores SQL, bind parameters, arguments, or results.</p>
    <h2>Native fetch</h2>
    <p>Supported outbound calls are captured automatically inside an active operation. Sightglass records destination host, method, normalized path, duration, status, and errors—never authorization headers or bodies.</p>
    <p>A W3C <code>traceparent</code> header is propagated. A downstream Sightglass service joins the distributed operation only when its receiving route is explicitly observed.</p>
  </>;

  return <>
    <DocHeading kicker="Run & configure" title="One process, one volume" summary="Sightglass is designed to remain boring to operate: one port, one SQLite file, and configurable retention." />
    <h2>Docker</h2><CodeBlock code={`docker compose up --build
# Dashboard and API: http://localhost:7777`} />
    <h2>SDK configuration</h2>
    <DefinitionGrid items={[
      ["service", "Required service identity"], ["endpoint", "Sightglass server URL"], ["environment", "Defaults to NODE_ENV"], ["apiKey", "Bearer token for ingestion"], ["meters", "Meter names and units"], ["batchSize", "Default 25 occurrences"], ["flushIntervalMs", "Default 2 seconds"], ["maxQueueSize", "Default 1,000"], ["meterSpoolDirectory", "Durable local meter spool"], ["healthIntervalMs", "Default 60 seconds"],
    ]} />
    <h2>Server environment</h2><CodeBlock code={`SIGHTGLASS_PORT=7777
SIGHTGLASS_DATABASE_PATH=/data/sightglass.db
SIGHTGLASS_API_KEY=replace-me
SIGHTGLASS_SUCCESS_RETENTION_DAYS=7
SIGHTGLASS_ERROR_RETENTION_DAYS=30
SIGHTGLASS_AGGREGATE_RETENTION_DAYS=365`} />
    <h2>Usage export</h2><p>Open Usage and export the exact ledger as CSV or JSON. Meter records are retained indefinitely and deduplicated by event ID.</p>
  </>;
}

function DocHeading({ kicker, title, summary }: { kicker: string; title: string; summary: string }) { return <header className="doc-heading"><p>{kicker}</p><h2>{title}</h2><span>{summary}</span></header>; }
function NumberedStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) { return <section className="doc-step"><b>{number}</b><div><h2>{title}</h2>{children}</div></section>; }
function ApiItem({ signature, description, code }: { signature: string; description: string; code?: string }) { return <section className="api-item"><h2><code>{signature}</code></h2><p>{description}</p>{code ? <CodeBlock code={code} /> : null}</section>; }
function Callout({ title, children }: { title: string; children: React.ReactNode }) { return <aside className="doc-callout"><strong>{title}</strong><p>{children}</p></aside>; }
function DefinitionGrid({ items }: { items: string[][] }) { return <dl className="definition-grid">{items.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>; }

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { if (!navigator.clipboard) return; void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }); };
  return <div className="code-block"><button onClick={copy}>{copied ? "Copied" : "Copy"}</button><pre><code>{code}</code></pre></div>;
}
