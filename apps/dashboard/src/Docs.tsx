import { useState } from "react";
import { benchmarkResults } from "./benchmark-results";

type DocId = "start" | "concepts" | "express" | "nest" | "next" | "prisma" | "api" | "benchmarks" | "compare" | "operate" | "production";

const pages: Array<{ id: DocId; label: string; eyebrow: string }> = [
  { id: "start", label: "Start here", eyebrow: "5 minute setup" },
  { id: "concepts", label: "Core API", eyebrow: "The five primitives" },
  { id: "express", label: "Express & tsoa", eyebrow: "Middleware" },
  { id: "nest", label: "NestJS", eyebrow: "Decorators" },
  { id: "next", label: "Next.js", eyebrow: "Route handlers" },
  { id: "prisma", label: "Prisma & fetch", eyebrow: "Automatic detail" },
  { id: "api", label: "API & exports", eyebrow: "Integrations" },
  { id: "benchmarks", label: "Benchmarks", eyebrow: "Measured locally" },
  { id: "compare", label: "Compare", eyebrow: "10 alternatives" },
  { id: "operate", label: "Run & configure", eyebrow: "Deployment" },
  { id: "production", label: "Production", eyebrow: "Security & recovery" },
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

  if (page === "api") return <>
    <DocHeading kicker="HTTP API" title="Query and export" summary="The opinionated dashboard uses a small read API that is also available for internal integrations." />
    <DefinitionGrid items={[
      ["GET /healthz", "Process readiness"], ["GET /api/v1/services", "Services and last-seen times"], ["GET /api/v1/summary", "Calls, errors, percentiles, unauthorized counts, and DB share"], ["GET /api/v1/occurrences", "Filterable occurrence list"], ["GET /api/v1/occurrences/:id", "Full detail and correlated operations"], ["GET /api/v1/traces/:traceId", "Distributed operation members"], ["GET /api/v1/database", "Prisma rankings and source operations"], ["GET /api/v1/dependencies", "Outbound rankings and source operations"], ["GET /api/v1/usage", "Exact usage totals, optionally by tenant"], ["GET /api/v1/health", "Process, host, and restart history"],
    ]} />
    <h2>Ranges and pagination</h2><p>Range endpoints accept ISO 8601 <code>from</code> and <code>to</code> values and default to 24 hours. Occurrences also accept <code>service</code>, <code>operation</code>, <code>status</code>, <code>limit</code>, and <code>offset</code>.</p>
    <h2>Exact ledger export</h2><CodeBlock code={`GET /api/v1/usage/export?from=2026-01-01T00:00:00.000Z
GET /api/v1/usage/export?format=json&from=2026-01-01T00:00:00.000Z`} />
  </>;

  if (page === "benchmarks") return <BenchmarkPage />;
  if (page === "compare") return <ComparisonPage />;

  if (page === "operate") return <>
    <DocHeading kicker="Run & configure" title="One process, one volume" summary="Sightglass is designed to remain boring to operate: one port, one SQLite file, and configurable retention." />
    <h2>Docker</h2><CodeBlock code={`docker compose up --build
# Dashboard and API: http://localhost:7777`} />
    <h2>SDK configuration</h2>
    <DefinitionGrid items={[
      ["service", "Required service identity"], ["endpoint", "Sightglass server URL"], ["environment", "Defaults to NODE_ENV"], ["apiKey", "Bearer token for ingestion"], ["meters", "Meter names and units"], ["batchSize", "Default 25 items"], ["flushIntervalMs", "Default 2 seconds"], ["maxQueueSize", "Default 1,000 per in-memory queue"], ["requestTimeoutMs", "Default 3 seconds"], ["retryBaseMs", "Default 500 ms"], ["retryMaxMs", "Default 60 seconds"], ["meterSpoolDirectory", "Durable local meter spool; false opts out"], ["fetchInstrumentation", "Automatic native fetch detail; default true"], ["healthIntervalMs", "Default 60 seconds; false disables"], ["onTelemetryError", "Diagnostic callback for delivery/spool failures"],
    ]} />
    <h2>Server environment</h2><CodeBlock code={`SIGHTGLASS_PORT=7777
SIGHTGLASS_DATABASE_PATH=/data/sightglass.db
SIGHTGLASS_API_KEY=replace-me
SIGHTGLASS_SUCCESS_RETENTION_DAYS=7
SIGHTGLASS_ERROR_RETENTION_DAYS=30
SIGHTGLASS_AGGREGATE_RETENTION_DAYS=365`} />
    <h2>Usage export</h2><p>Open Usage and export the exact ledger as CSV or JSON. Meter records are retained indefinitely and deduplicated by event ID.</p>
  </>;

  return <>
    <DocHeading kicker="Production" title="Operate the boundary safely" summary="Back up the one volume, keep reads private, and monitor durable meter delivery." />
    <Callout title="Trusted network required">The API key authenticates ingestion only. Dashboard and read APIs must stay on a trusted private network or behind an authenticating TLS reverse proxy.</Callout>
    <h2>Backup and restore</h2><p>SQLite uses WAL mode. Use SQLite's online backup command, or stop the container before copying the database together with its <code>-wal</code> and <code>-shm</code> files. Restore while stopped.</p>
    <h2>Upgrade</h2><p>Back up the volume, rebuild or pull the image, and recreate the container with the same volume. Transactional migrations run at startup. Restore the matching backup instead of downgrading an upgraded database.</p>
    <h2>Durable usage recovery</h2><p>Each meter is synced to the local spool before its ID is returned. Backlogs are drained through bounded memory and files are removed only after acknowledgement. Put the spool on durable storage and monitor its size.</p>
    <CodeBlock code={`configureSightglass({
  service: "billing-api",
  endpoint: "http://sightglass:7777",
  meterSpoolDirectory: "/var/lib/my-app/sightglass-spool",
  onTelemetryError(error, area) {
    logger.error({ error, area }, "Sightglass delivery degraded");
  }
});`} />
    <h2>SDK packages from this checkout</h2><CodeBlock code={`npm run build
npm run pack:sdk
# Install the required tarballs from dist-packages/ in your application`} />
  </>;
}

function DocHeading({ kicker, title, summary }: { kicker: string; title: string; summary: string }) { return <header className="doc-heading"><p>{kicker}</p><h2>{title}</h2><span>{summary}</span></header>; }
function NumberedStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) { return <section className="doc-step"><b>{number}</b><div><h2>{title}</h2>{children}</div></section>; }
function ApiItem({ signature, description, code }: { signature: string; description: string; code?: string }) { return <section className="api-item"><h2><code>{signature}</code></h2><p>{description}</p>{code ? <CodeBlock code={code} /> : null}</section>; }
function Callout({ title, children }: { title: string; children: React.ReactNode }) { return <aside className="doc-callout"><strong>{title}</strong><p>{children}</p></aside>; }
function DefinitionGrid({ items }: { items: string[][] }) { return <dl className="definition-grid">{items.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>; }

function BenchmarkPage() {
  const result = benchmarkResults;
  return <>
    <DocHeading kicker="Benchmarks" title="Measured, not promised" summary="Deterministic fixtures, excluded warmups, repeated samples, raw data, and machine metadata make these results auditable and reproducible." />
    <BenchmarkChart title="Ingestion throughput" subtitle="Median of five 10,000-record iterations; higher is better" items={result.throughput.map((item) => ({ label: item.label, value: item.statistics.median, suffix: item.unit }))} />
    <BenchmarkChart title="Dashboard query latency" subtitle="p95 across 30 warm-cache samples over 25,000 rich occurrences; lower is better" items={result.queryLatency.map((item) => ({ label: item.label, value: item.statistics.p95, suffix: "ms" }))} />
    <div className="benchmark-facts"><MetricFact value={`${Math.round(result.storage.bytesPerRichOccurrence).toLocaleString()} B`} label="SQLite bytes / rich operation" /><MetricFact value={`${result.storage.jsonPayloadBytesPerOccurrence.toLocaleString()} B`} label="JSON bytes / operation + meter" /><MetricFact value={`${result.environment.logicalCpus}`} label="Logical CPUs" /><MetricFact value={result.environment.node} label="Node.js" /></div>
    <h2>Reproduce it</h2><CodeBlock code={`npm ci
npm run benchmark`} />
    <p>The command builds the real server, creates isolated temporary databases, runs the complete suite, and replaces the checked-in raw JSON and SVG charts. Override counts with <code>SIGHTGLASS_BENCHMARK_COUNT</code>, <code>SIGHTGLASS_BENCHMARK_ITERATIONS</code>, <code>SIGHTGLASS_BENCHMARK_QUERY_COUNT</code>, and <code>SIGHTGLASS_BENCHMARK_QUERY_ITERATIONS</code>.</p>
    <Callout title="Interpretation boundary">These figures describe this commit on the recorded machine, not guaranteed production capacity. HTTP measurements include serialization, parsing, validation, routing, and WAL persistence. They exclude client networking because the server is reached through loopback.</Callout>
    <p className="doc-meta">Captured {new Date(result.generatedAt).toLocaleString()} · {result.environment.cpu} · {result.environment.platform} {result.environment.architecture}</p>
  </>;
}

type ChartDatum = { label: string; value: number; suffix: string };
function BenchmarkChart({ title, subtitle, items }: { title: string; subtitle: string; items: readonly ChartDatum[] }) {
  const maximum = Math.max(...items.map((item) => item.value));
  return <section className="benchmark-chart"><div><h2>{title}</h2><p>{subtitle}</p></div>{items.map((item) => <div className="benchmark-row" key={item.label}><span>{item.label}</span><i><b style={{ width: `${Math.max(2, item.value / maximum * 100)}%` }} /></i><strong>{formatBenchmark(item.value)} <small>{item.suffix}</small></strong></div>)}</section>;
}
function formatBenchmark(value: number): string { return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(value < 1 ? 3 : 2); }
function MetricFact({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

type FeatureValue = "yes" | "partial" | "no";
type ComparisonProduct = { name: string; deployment: string; pricing: string; oss: FeatureValue; optIn: FeatureValue; events: FeatureValue; ledger: FeatureValue; traces: FeatureValue; db: FeatureValue; health: FeatureValue; oneContainer: FeatureValue; noCollector: FeatureValue; source: string };
const comparisonProducts: ComparisonProduct[] = [
  { name: "Sightglass", deployment: "Self-host · 1 container", pricing: "Free; infrastructure only", oss: "yes", optIn: "yes", events: "yes", ledger: "yes", traces: "yes", db: "yes", health: "yes", oneContainer: "yes", noCollector: "yes", source: "https://github.com/bazokhan/sightglass" },
  { name: "Datadog APM", deployment: "SaaS + host agent", pricing: "From $31/host/mo annual", oss: "no", optIn: "no", events: "yes", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "no", source: "https://www.datadoghq.com/pricing/?product=apm" },
  { name: "New Relic", deployment: "SaaS + app/host agents", pricing: "Free tier; $0.40/GB + access", oss: "no", optIn: "no", events: "yes", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "partial", source: "https://newrelic.com/pricing" },
  { name: "Honeycomb", deployment: "SaaS · SDK/OTel", pricing: "Free; Pro from $150/mo", oss: "no", optIn: "partial", events: "yes", ledger: "no", traces: "yes", db: "partial", health: "partial", oneContainer: "no", noCollector: "yes", source: "https://www.honeycomb.io/pricing" },
  { name: "Grafana", deployment: "Cloud or self-host stack", pricing: "OSS free; Cloud $19 + usage", oss: "yes", optIn: "no", events: "partial", ledger: "no", traces: "yes", db: "partial", health: "yes", oneContainer: "no", noCollector: "no", source: "https://grafana.com/pricing/" },
  { name: "Sentry", deployment: "SaaS or self-host stack", pricing: "Free; Team $26/mo", oss: "no", optIn: "partial", events: "partial", ledger: "no", traces: "yes", db: "yes", health: "partial", oneContainer: "no", noCollector: "yes", source: "https://sentry.io/pricing/" },
  { name: "Dynatrace", deployment: "SaaS or Managed + OneAgent", pricing: "$58/8-GiB host/mo", oss: "no", optIn: "no", events: "yes", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "no", source: "https://www.dynatrace.com/pricing/" },
  { name: "SigNoz", deployment: "Cloud or self-host stack", pricing: "Community free; Cloud $49/mo", oss: "yes", optIn: "no", events: "partial", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "no", source: "https://signoz.io/pricing/" },
  { name: "Better Stack", deployment: "SaaS + optional collector", pricing: "Free; bundles from $25/mo annual", oss: "no", optIn: "no", events: "partial", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "partial", source: "https://betterstack.com/pricing" },
  { name: "Elastic Observability", deployment: "Cloud or self-host stack", pricing: "Self-host free; Cloud usage-priced", oss: "yes", optIn: "no", events: "yes", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "no", source: "https://www.elastic.co/pricing/" },
  { name: "Uptrace", deployment: "Cloud or self-host stack", pricing: "Community free; 50 GB Cloud free", oss: "yes", optIn: "partial", events: "partial", ledger: "no", traces: "yes", db: "yes", health: "yes", oneContainer: "no", noCollector: "yes", source: "https://uptrace.dev/pricing" },
];

function ComparisonPage() {
  const features: Array<[keyof ComparisonProduct, string]> = [["oss", "OSS"], ["optIn", "Opt-in"], ["events", "Events"], ["ledger", "Ledger"], ["traces", "Traces"], ["db", "DB/deps"], ["health", "Health"], ["oneContainer", "1 ctr"], ["noCollector", "No daemon"]];
  return <>
    <DocHeading kicker="Market comparison" title="Small by design" summary="Sightglass trades fleet-scale breadth for an explicit operation model, exact usage accounting, and a deployment that stays one container." />
    <div className="comparison-legend"><span><FeatureIcon value="yes" /> native</span><span><FeatureIcon value="partial" /> partial / configurable</span><span><FeatureIcon value="no" /> absent / not core</span></div>
    <div className="comparison-wrap"><table className="comparison-table"><thead><tr><th>Product</th>{features.map(([, label]) => <th title={featureTitle(label)} key={label}>{label}</th>)}<th className="comparison-meta">Deployment</th><th className="comparison-meta">Public starting price</th></tr></thead><tbody>{comparisonProducts.map((product) => <tr className={product.name === "Sightglass" ? "ours" : ""} key={product.name}><td><a href={product.source} target="_blank" rel="noreferrer">{product.name}</a></td>{features.map(([key, label]) => <td className="feature-cell" aria-label={`${label}: ${product[key]}`} key={key}><FeatureIcon value={product[key] as FeatureValue} /></td>)}<td className="comparison-meta">{product.deployment}</td><td className="comparison-meta">{product.pricing}</td></tr>)}</tbody></table></div>
    <p className="doc-meta">Checked 12 September 2026 against vendors' official public pricing, deployment, and licensing material. Prices are USD list prices where available, exclude infrastructure and negotiated discounts, and can change.</p>
    <h2>What the icons mean</h2><p><strong>Opt-in</strong> means unselected application routes remain silent by product doctrine. <strong>Ledger</strong> means an exact, idempotent, exportable business-usage ledger—not ordinary custom metrics. <strong>1 ctr</strong> means the complete server, storage, API, and UI run in one container. <strong>No daemon</strong> means application telemetry can be delivered without a host-level agent or collector.</p>
    <Callout title="A focused comparison">This is not a claim that Sightglass has greater total breadth. The larger platforms add logs, RUM, synthetics, alerting, security, AI, and enterprise controls. This table focuses on the application-observability job Sightglass was designed to do.</Callout>
  </>;
}
function FeatureIcon({ value }: { value: FeatureValue }) { return <span className={`feature-icon ${value}`} aria-hidden="true">{value === "yes" ? "✓" : value === "partial" ? "◐" : "×"}</span>; }
function featureTitle(label: string): string { return ({ OSS: "Open-source product core", "Opt-in": "Strict explicit-operation model", Events: "Semantic application events", Ledger: "Exact idempotent usage ledger", Traces: "Distributed tracing", "DB/deps": "Database and outbound dependency detail", Health: "Application/runtime health", "1 ctr": "Complete one-container deployment", "No daemon": "No required host daemon or collector" } as Record<string, string>)[label] ?? label; }

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { if (!navigator.clipboard) return; void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }); };
  return <div className="code-block"><button onClick={copy}>{copied ? "Copied" : "Copy"}</button><pre><code>{code}</code></pre></div>;
}
