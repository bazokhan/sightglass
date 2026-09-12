import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Activity, BookOpen, Boxes, Database, Gauge, Layers3, Network, RefreshCw } from "lucide-react";
import { loadDashboard, loadOccurrence } from "./api";
import type { Health, OccurrenceRow, Ranking, Summary, Trend, Usage, UsageTrend } from "./api";

type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
type Tab = "Overview" | "Operations" | "Database" | "Dependencies" | "Usage" | "Health";
const tabs = [
  { label: "Overview" as const, icon: Layers3 },
  { label: "Operations" as const, icon: Activity },
  { label: "Database" as const, icon: Database },
  { label: "Dependencies" as const, icon: Network },
  { label: "Usage" as const, icon: Boxes },
  { label: "Health" as const, icon: Gauge },
];
const validHours = new Set([1, 24, 168, 720]);
const docsUrl = "https://sightglass-docs.vercel.app/docs";

function readUrlState() {
  const query = new URLSearchParams(window.location.search);
  const requestedTab = query.get("view");
  const tab = tabs.find(({ label }) => label.toLowerCase() === requestedTab)?.label ?? "Overview";
  const requestedHours = Number(query.get("hours"));
  return { tab, hours: validHours.has(requestedHours) ? requestedHours : 24, service: query.get("service") ?? "", environment: query.get("environment") ?? "" };
}

export function App() {
  const initial = useMemo(readUrlState, []);
  const [hours, setHours] = useState(initial.hours);
  const [service, setService] = useState(initial.service);
  const [environment, setEnvironment] = useState(initial.environment);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<Record<string, any>>();
  const [pending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    setError(undefined);
    startTransition(() => { void loadDashboard(hours, { service, environment }).then(setData).catch((reason: Error) => setError(reason.message)); });
  }, [environment, hours, service]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    const query = new URLSearchParams();
    if (tab !== "Overview") query.set("view", tab.toLowerCase());
    if (hours !== 24) query.set("hours", String(hours));
    if (service) query.set("service", service);
    if (environment) query.set("environment", environment);
    const next = `${window.location.pathname}${query.size ? `?${query}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [environment, hours, service, tab]);
  useEffect(() => {
    const restore = () => { const state = readUrlState(); setTab(state.tab); setHours(state.hours); setService(state.service); setEnvironment(state.environment); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const openOccurrence = useCallback((id: string) => { void loadOccurrence(id).then(setSelected).catch((reason: Error) => setError(reason.message)); }, []);
  const closeOccurrence = useCallback(() => setSelected(undefined), []);

  return <div className="shell">
    <aside>
      <div className="brand"><Logo /><div><strong>Sightglass</strong><span>Application observability</span></div></div>
      <nav aria-label="Dashboard views">{tabs.map(({ label, icon: Icon }) => <button className={label === tab ? "active" : ""} key={label} onClick={() => { window.history.pushState(null, "", window.location.href); setTab(label); }} aria-current={label === tab ? "page" : undefined}><Icon aria-hidden="true" />{label}</button>)}</nav>
      <a className="docs-link" href={docsUrl} target="_blank" rel="noreferrer"><BookOpen aria-hidden="true" />Documentation<span>↗</span></a>
      <div className="aside-note"><i /> Live · explicit operations only</div>
    </aside>
    <main>
      <header><div><p className="eyebrow">Application observability</p><h1>{tab}</h1><p className="page-description">Focused telemetry from operations your application deliberately marks.</p></div><div className="controls"><label><span>Service</span><select aria-label="Service" value={service} onChange={(event) => { setService(event.target.value); setEnvironment(""); }}><option value="">All services</option>{[...new Set(data?.services.map((item) => item.service) ?? [])].map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span>Environment</span><select aria-label="Environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}><option value="">All environments</option>{[...new Set((data?.services ?? []).filter((item) => !service || item.service === service).map((item) => item.environment))].map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span>Range</span><select aria-label="Time range" value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select></label><button className="refresh" onClick={refresh} disabled={pending}><RefreshCw aria-hidden="true" />{pending ? "Refreshing…" : "Refresh"}</button></div></header>
      {error ? <div className="error" role="alert"><strong>Could not load telemetry.</strong> {error} Check the server and try refreshing.</div> : null}
      {!data ? <Loading /> : <Content tab={tab} data={data} openOccurrence={openOccurrence} />}
    </main>
    {selected ? <OccurrenceDetail value={selected} close={closeOccurrence} /> : null}
  </div>;
}

function Content({ tab, data, openOccurrence }: { tab: Tab; data: DashboardData; openOccurrence(id: string): void }) {
  if (tab === "Overview") return <Overview data={data} openOccurrence={openOccurrence} />;
  if (tab === "Operations") return <Operations rows={data.occurrences} openOccurrence={openOccurrence} />;
  if (tab === "Database") return <RankingTable title="Database work" subtitle="Normalized Prisma operations ranked by aggregate time." rows={data.database} columns={["sourceOperation", "operation", "calls", "totalMs", "averageMs", "slowestMs"]} />;
  if (tab === "Dependencies") return <RankingTable title="Outbound dependencies" subtitle="Safe destinations and normalized paths captured inside observed operations." rows={data.dependencies} columns={["sourceOperation", "host", "method", "path", "calls", "errors", "averageMs", "slowestMs"]} />;
  if (tab === "Usage") return <UsageView rows={data.usage} trend={data.usageTrend} exportQuery={data.query} />;
  return <HealthView rows={data.health} />;
}

function Overview({ data, openOccurrence }: { data: DashboardData; openOccurrence(id: string): void }) {
  const totals = useMemo(() => data.summary.reduce((state, row) => ({ calls: state.calls + Number(row.calls), errors: state.errors + Number(row.errors), duration: state.duration + Number(row.averageMs) * Number(row.calls) }), { calls: 0, errors: 0, duration: 0 }), [data.summary]);
  const p95 = Math.max(0, ...data.summary.map((row) => Number(row.p95)));
  return <>
    <section className="metric-grid">
      <Metric label="Observed operations" value={format(totals.calls)} detail={`${data.summary.length} named operations`} />
      <Metric label="Error rate" value={`${totals.calls ? ((totals.errors / totals.calls) * 100).toFixed(1) : "0.0"}%`} detail={`${totals.errors} failed occurrences`} tone={totals.errors ? "bad" : "good"} />
      <Metric label="Average latency" value={`${totals.calls ? Math.round(totals.duration / totals.calls) : 0} ms`} detail="Across explicit operations" />
      <Metric label="Highest p95" value={`${Math.round(p95)} ms`} detail="Slowest operation tail" />
    </section>
    <TrendPanel rows={data.trend} />
    <section className="panel"><PanelHeading title="Operation pulse" subtitle="Volume, reliability, latency, and database contribution." /><SummaryTable rows={data.summary} /></section>
    <section className="panel"><PanelHeading title="Recent occurrences" subtitle="The latest information-dense executions." /><OccurrenceTable rows={data.occurrences.slice(0, 8)} openOccurrence={openOccurrence} /></section>
  </>;
}

function Operations({ rows, openOccurrence }: { rows: OccurrenceRow[]; openOccurrence(id: string): void }) { return <section className="panel"><PanelHeading title="Observed operations" subtitle="Only executions your application deliberately selected." /><OccurrenceTable rows={rows} openOccurrence={openOccurrence} /></section>; }

function SummaryTable({ rows }: { rows: Summary[] }) { return rows.length ? <div className="table-wrap"><table><thead><tr><th>Operation</th><th>Service</th><th>Calls</th><th>Errors</th><th>p50</th><th>p95</th><th>p99</th><th>DB share</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.service}:${row.operation}`}><td className="primary">{row.operation}</td><td>{row.service}</td><td>{row.calls}</td><td><Status bad={row.errors > 0}>{row.errorRate}%</Status></td><td>{row.p50} ms</td><td>{row.p95} ms</td><td>{row.p99} ms</td><td>{row.dbShare}%</td></tr>)}</tbody></table></div> : <Empty />; }

function OccurrenceTable({ rows, openOccurrence }: { rows: OccurrenceRow[]; openOccurrence(id: string): void }) { return rows.length ? <div className="table-wrap"><table><thead><tr><th>When</th><th>Operation</th><th>Service</th><th>Status</th><th>Duration</th><th>Context</th></tr></thead><tbody>{rows.map((row) => <tr className="clickable" key={row.id} tabIndex={0} onClick={() => openOccurrence(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openOccurrence(row.id); } }}><td>{relative(row.startedAt)}</td><td className="primary">{row.operation}</td><td>{row.service}</td><td><Status bad={row.status === "error"}>{row.status}</Status></td><td>{row.durationMs} ms</td><td className="context">{Object.entries(row.context).slice(0, 2).map(([key, value]) => `${key}: ${value}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div> : <Empty />; }

function RankingTable({ title, subtitle, rows, columns }: { title: string; subtitle: string; rows: Ranking[]; columns: string[] }) { return <section className="panel"><PanelHeading title={title} subtitle={subtitle} />{rows.length ? <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column, cell) => <td className={cell === 0 ? "primary" : ""} key={column}>{formatCell(row[column], column)}</td>)}</tr>)}</tbody></table></div> : <Empty />}</section>; }

function UsageView({ rows, trend, exportQuery }: { rows: Usage[]; trend: UsageTrend[]; exportQuery: string }) {
  const meters = [...new Set(trend.map((row) => row.meter))];
  const [selectedMeter, setSelectedMeter] = useState("");
  const meter = meters.includes(selectedMeter) ? selectedMeter : (meters[0] ?? "");
  const series = trend.filter((row) => row.meter === meter);
  const totalEvents = rows.reduce((sum, row) => sum + Number(row.events), 0);
  return <><section className="metric-grid two"><Metric label="Ledger events" value={format(totalEvents)} detail="Idempotent durable records" /><Metric label="Active meters" value={String(new Set(rows.map((row) => row.meter)).size)} detail="Exact usage, never estimated" /></section><section className="panel"><div className="chart-heading"><PanelHeading title="Usage over time" subtitle="Exact quantities from the durable hourly meter ledger." />{meters.length > 1 ? <select aria-label="Usage meter" value={meter} onChange={(event) => setSelectedMeter(event.target.value)}>{meters.map((item) => <option value={item} key={item}>{item}</option>)}</select> : null}</div>{series.length ? <div className="single-chart"><Sparkline values={series.map((row) => Number(row.quantity))} labels={series.map((row) => row.hour)} /><ChartScale value={`${format(series.reduce((sum, row) => sum + Number(row.quantity), 0))} ${series[0]?.unit ?? "units"}`} label={meter} /></div> : <Empty />}</section><section className="panel"><div className="panel-heading with-action"><PanelHeading title="Usage ledger" subtitle="Grouped by meter, customer, and service." /><div><a className="export" href={`/api/v1/usage/export?${exportQuery}`}>Export CSV</a><a className="export" href={`/api/v1/usage/export?${exportQuery}&format=json`}>JSON</a></div></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Meter</th><th>Tenant</th><th>Service</th><th>Quantity</th><th>Unit</th><th>Events</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.meter}:${row.tenantId}:${index}`}><td className="primary">{row.meter}</td><td>{row.tenantId ?? "Unassigned"}</td><td>{row.service}</td><td>{format(row.quantity)}</td><td>{row.unit ?? "units"}</td><td>{row.events}</td></tr>)}</tbody></table></div> : <Empty />}</section></>;
}

function HealthView({ rows }: { rows: Health[] }) {
  const grouped = new Map<string, Health[]>();
  for (const row of rows) { const key = `${row.service}:${row.environment}`; const group = grouped.get(key) ?? []; group.push(row); grouped.set(key, group); }
  return <section className="panel"><PanelHeading title="Service health" subtitle="Process and host context with trends and restart history for the selected range." />{grouped.size ? <div className="health-grid">{[...grouped.entries()].map(([key, samples]) => { const row = samples.at(-1)!; return <article className={`health-card ${row.restartCount ? "restarted" : ""}`} key={key}><div><i /><strong>{row.service}</strong><span>{row.environment} · PID {row.pid}</span></div><div className="health-trends"><MiniTrend label="CPU" values={samples.map((item) => item.cpuPercent)} suffix="%" /><MiniTrend label="Memory" values={samples.map((item) => item.memoryRssBytes / 1024 / 1024)} suffix=" MB" /><MiniTrend label="Loop lag" values={samples.map((item) => item.eventLoopLagMs)} suffix=" ms" /></div><dl><dt>Restarts</dt><dd>{row.restartCount ?? 0}</dd><dt>Host free</dt><dd>{row.hostMemoryFreeBytes === undefined ? "—" : bytes(row.hostMemoryFreeBytes)}</dd><dt>Load (1m)</dt><dd>{row.hostLoad1m?.toFixed(2) ?? "—"}</dd><dt>Disk free</dt><dd>{row.diskFreeBytes === undefined ? "—" : bytes(row.diskFreeBytes)}</dd><dt>Uptime</dt><dd>{duration(row.uptimeSeconds)}</dd></dl></article>; })}</div> : <Empty />}</section>;
}

function OccurrenceDetail({ value, close }: { value: Record<string, any>; close(): void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    priorFocus.current = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); priorFocus.current?.focus(); };
  }, [close]);
  const timeline = [...(value.events ?? []).map((item: any) => ({ ...item, kind: "event", durationMs: null })), ...(value.steps ?? []).map((item: any) => ({ ...item, kind: "step" })), ...(value.database?.operations ?? []).map((item: any) => ({ ...item, kind: "database", name: `${item.model}.${item.action}` })), ...(value.dependencies ?? []).map((item: any) => ({ ...item, kind: "dependency", name: `${item.method} ${item.host}${item.path}` }))].sort((a, b) => a.atMs - b.atMs);
  return <div className="overlay" onMouseDown={close}><article className="drawer" role="dialog" aria-modal="true" aria-labelledby="occurrence-title" onMouseDown={(event) => event.stopPropagation()}><button ref={closeButton} className="close" onClick={close} aria-label="Close occurrence details">×</button><p className="eyebrow">Occurrence</p><h2 id="occurrence-title">{value.operation}</h2><div className="detail-meta"><Status bad={value.status === "error"}>{value.status}</Status><span>{value.durationMs} ms</span><span>{value.service}</span><span>{new Date(value.startedAt).toLocaleString()}</span></div>{value.error ? <div className="error-stack"><strong>{value.error.type}: {value.error.message}</strong><pre>{value.error.stack}</pre></div> : null}<h3>Business context</h3><div className="chips">{Object.entries(value.context ?? {}).map(([key, item]) => <span key={key}>{key}<b>{String(item)}</b></span>)}</div><h3>Distributed operation tree</h3><DistributedTree occurrences={value.distributedOccurrences ?? [value]} currentId={value.id} /><h3>Local timeline</h3><div className="timeline">{timeline.length ? timeline.map((item) => <div key={item.id}><i className={item.kind} /><span>{item.atMs} ms</span><strong>{item.name}</strong><em>{item.durationMs === null ? item.kind : `${item.durationMs} ms`}</em></div>) : <p>No child activity was captured.</p>}</div><h3>Correlation</h3><code>{value.distributed?.traceId}</code></article></div>;
}

function DistributedTree({ occurrences, currentId }: { occurrences: any[]; currentId: string }) {
  const bySpan = new Map(occurrences.map((item) => [item.distributed?.spanId, { item, children: [] as any[] }]));
  const roots: Array<{ item: any; children: any[] }> = [];
  for (const node of bySpan.values()) { const parent = bySpan.get(node.item.distributed?.parentId); if (parent) parent.children.push(node); else roots.push(node); }
  const render = (node: { item: any; children: any[] }, depth: number): React.ReactNode => {
    const technical = [...(node.item.database?.operations ?? []).map((item: any) => ({ ...item, label: `${item.model}.${item.action}`, kind: "database" })), ...(node.item.dependencies ?? []).map((item: any) => ({ ...item, label: `${item.method} ${item.host}${item.path}`, kind: "dependency" }))];
    return <div className="trace-branch" key={node.item.id}><div className={`trace-node ${node.item.id === currentId ? "current" : ""}`} style={{ marginLeft: depth * 18 }}><Status bad={node.item.status === "error"}>{node.item.status}</Status><strong>{node.item.service}</strong><span>{node.item.operation}</span><em>{node.item.durationMs} ms</em></div>{technical.map((item) => <div className="trace-node technical" style={{ marginLeft: (depth + 1) * 18 }} key={`${node.item.id}:${item.id}`}><Status bad={item.status === "error"}>{item.status}</Status><strong>{item.kind}</strong><span>{item.label}</span><em>{item.durationMs} ms</em></div>)}{node.children.map((child) => render(child, depth + 1))}</div>;
  };
  return <div className="trace-tree">{roots.map((root) => render(root, 0))}</div>;
}

function TrendPanel({ rows }: { rows: Trend[] }) {
  const charts = [
    { label: "Throughput", value: rows.reduce((sum, row) => sum + Number(row.calls), 0), suffix: " calls", values: rows.map((row) => Number(row.calls)) },
    { label: "Error rate", value: rows.at(-1)?.errorRate ?? 0, suffix: "% latest", values: rows.map((row) => Number(row.errorRate)) },
    { label: "p95 latency", value: rows.at(-1)?.p95 ?? 0, suffix: " ms latest", values: rows.map((row) => Number(row.p95)) },
  ];
  return <section className="panel"><PanelHeading title="Change over time" subtitle="Hourly volume, reliability, and tail latency for the current selection." />{rows.length ? <div className="trend-grid">{charts.map((chart) => <article className="trend-card" key={chart.label}><Sparkline values={chart.values} labels={rows.map((row) => row.hour)} /><ChartScale value={`${formatValue(chart.value)}${chart.suffix}`} label={chart.label} /></article>)}</div> : <Empty />}</section>;
}

function MiniTrend({ label, values, suffix }: { label: string; values: number[]; suffix: string }) {
  return <div><span>{label}</span><Sparkline values={values} labels={[]} compact /><strong>{formatValue(values.at(-1) ?? 0)}{suffix}</strong></div>;
}

function Sparkline({ values, labels, compact = false }: { values: number[]; labels: string[]; compact?: boolean }) {
  const width = 240; const height = compact ? 42 : 84; const padding = 4;
  let minimum = Infinity; let maximum = -Infinity;
  for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  const range = maximum - minimum || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (values.length - 1);
    const y = height - padding - (value - minimum) / range * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const description = labels.length ? `${new Date(labels[0]!).toLocaleString()} to ${new Date(labels.at(-1)!).toLocaleString()}` : "Recent samples";
  return <svg className={`sparkline ${compact ? "compact" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"><title>{description}</title><line x1="4" y1={height - 4} x2={width - 4} y2={height - 4} /><polyline points={points} /></svg>;
}

function ChartScale({ value, label }: { value: string; label: string }) { return <div className="chart-scale"><strong>{value}</strong><span>{label}</span></div>; }

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) { return <article className={`metric ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="panel-heading"><h2>{title}</h2><p>{subtitle}</p></div>; }
function Status({ bad, children }: { bad: boolean; children: React.ReactNode }) { return <span className={`status ${bad ? "bad" : "good"}`}>{children}</span>; }
function Empty() { return <div className="empty"><Logo /><strong>No observed data yet</strong><p>Instrument one operation, exercise it, and it will appear here.</p></div>; }
function Loading() { return <div className="loading"><i /><span>Looking through the glass…</span></div>; }
function Logo() { return <svg className="logo" viewBox="0 0 42 42" aria-hidden="true"><path d="M9 3h24v7c0 5-3 7-5 10 2 3 5 5 5 12v7H9v-7c0-7 3-9 5-12-2-3-5-5-5-10V3Z"/><path className="liquid" d="M14 28c3-3 5-3 7-2 3 2 5 2 7-1v8H14v-5Z"/></svg>; }
function format(value: number) { return new Intl.NumberFormat().format(value); }
function relative(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 1000)); if (seconds < 60) return `${seconds}s ago`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return new Date(value).toLocaleDateString(); }
function humanize(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function formatCell(value: unknown, column: string) { if (typeof value === "number" && column.toLowerCase().includes("ms")) return `${value} ms`; return value === null ? "—" : String(value); }
function bytes(value: number) { return `${(value / 1024 / 1024).toFixed(0)} MB`; }
function formatValue(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value); }
function duration(seconds: number) { const hours = Math.floor(seconds / 3600); return hours > 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`; }
