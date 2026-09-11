import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { loadDashboard, loadOccurrence } from "./api";
import type { Health, OccurrenceRow, Ranking, Summary, Usage } from "./api";
import { DocsView } from "./Docs";

type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
type Tab = "Overview" | "Operations" | "Database" | "Dependencies" | "Usage" | "Health" | "Docs";
const tabs: Tab[] = ["Overview", "Operations", "Database", "Dependencies", "Usage", "Health", "Docs"];

export function App() {
  const [hours, setHours] = useState(24);
  const [tab, setTab] = useState<Tab>("Overview");
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<Record<string, any>>();
  const [pending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    setError(undefined);
    startTransition(() => { void loadDashboard(hours).then(setData).catch((reason: Error) => setError(reason.message)); });
  }, [hours]);
  useEffect(refresh, [refresh]);
  const openOccurrence = useCallback((id: string) => { void loadOccurrence(id).then(setSelected).catch((reason: Error) => setError(reason.message)); }, []);

  return <div className="shell">
    <aside>
      <div className="brand"><Logo /><div><strong>Sightglass</strong><span>Observe what matters.</span></div></div>
      <nav>{tabs.map((item) => <button className={item === tab ? "active" : ""} key={item} onClick={() => setTab(item)}><NavIcon label={item} />{item}</button>)}</nav>
      <div className="aside-note"><i /> Collecting only explicit operations</div>
    </aside>
    <main>
      <header><div><p className="eyebrow">{tab === "Docs" ? "Product guide" : "Application observability"}</p><h1>{tab}</h1></div>{tab === "Docs" ? null : <div className="controls"><select aria-label="Time range" value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select><button className="refresh" onClick={refresh} disabled={pending}>{pending ? "Loading…" : "Refresh"}</button></div>}</header>
      {tab !== "Docs" && error ? <div className="error"><strong>Could not load telemetry.</strong> {error}</div> : null}
      {tab === "Docs" ? <DocsView /> : !data ? <Loading /> : <Content tab={tab} data={data} openOccurrence={openOccurrence} />}
    </main>
    {selected ? <OccurrenceDetail value={selected} close={() => setSelected(undefined)} /> : null}
  </div>;
}

function Content({ tab, data, openOccurrence }: { tab: Tab; data: DashboardData; openOccurrence(id: string): void }) {
  if (tab === "Overview") return <Overview data={data} openOccurrence={openOccurrence} />;
  if (tab === "Operations") return <Operations rows={data.occurrences} openOccurrence={openOccurrence} />;
  if (tab === "Database") return <RankingTable title="Database work" subtitle="Normalized Prisma operations ranked by aggregate time." rows={data.database} columns={["sourceOperation", "operation", "calls", "totalMs", "averageMs", "slowestMs"]} />;
  if (tab === "Dependencies") return <RankingTable title="Outbound dependencies" subtitle="Safe destinations and normalized paths captured inside observed operations." rows={data.dependencies} columns={["sourceOperation", "host", "method", "path", "calls", "errors", "averageMs", "slowestMs"]} />;
  if (tab === "Usage") return <UsageView rows={data.usage} from={data.from} />;
  if (tab === "Docs") return <DocsView />;
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
    <section className="panel"><PanelHeading title="Operation pulse" subtitle="Volume, reliability, latency, and database contribution." /><SummaryTable rows={data.summary} /></section>
    <section className="panel"><PanelHeading title="Recent occurrences" subtitle="The latest information-dense executions." /><OccurrenceTable rows={data.occurrences.slice(0, 8)} openOccurrence={openOccurrence} /></section>
  </>;
}

function Operations({ rows, openOccurrence }: { rows: OccurrenceRow[]; openOccurrence(id: string): void }) { return <section className="panel"><PanelHeading title="Observed operations" subtitle="Only executions your application deliberately selected." /><OccurrenceTable rows={rows} openOccurrence={openOccurrence} /></section>; }

function SummaryTable({ rows }: { rows: Summary[] }) { return rows.length ? <div className="table-wrap"><table><thead><tr><th>Operation</th><th>Service</th><th>Calls</th><th>Errors</th><th>p50</th><th>p95</th><th>p99</th><th>DB share</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.service}:${row.operation}`}><td className="primary">{row.operation}</td><td>{row.service}</td><td>{row.calls}</td><td><Status bad={row.errors > 0}>{row.errorRate}%</Status></td><td>{row.p50} ms</td><td>{row.p95} ms</td><td>{row.p99} ms</td><td>{row.dbShare}%</td></tr>)}</tbody></table></div> : <Empty />; }

function OccurrenceTable({ rows, openOccurrence }: { rows: OccurrenceRow[]; openOccurrence(id: string): void }) { return rows.length ? <div className="table-wrap"><table><thead><tr><th>When</th><th>Operation</th><th>Service</th><th>Status</th><th>Duration</th><th>Context</th></tr></thead><tbody>{rows.map((row) => <tr className="clickable" key={row.id} onClick={() => openOccurrence(row.id)}><td>{relative(row.startedAt)}</td><td className="primary">{row.operation}</td><td>{row.service}</td><td><Status bad={row.status === "error"}>{row.status}</Status></td><td>{row.durationMs} ms</td><td className="context">{Object.entries(row.context).slice(0, 2).map(([key, value]) => `${key}: ${value}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div> : <Empty />; }

function RankingTable({ title, subtitle, rows, columns }: { title: string; subtitle: string; rows: Ranking[]; columns: string[] }) { return <section className="panel"><PanelHeading title={title} subtitle={subtitle} />{rows.length ? <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column, cell) => <td className={cell === 0 ? "primary" : ""} key={column}>{formatCell(row[column], column)}</td>)}</tr>)}</tbody></table></div> : <Empty />}</section>; }

function UsageView({ rows, from }: { rows: Usage[]; from: string }) { const totalEvents = rows.reduce((sum, row) => sum + Number(row.events), 0); return <><section className="metric-grid two"><Metric label="Ledger events" value={format(totalEvents)} detail="Idempotent durable records" /><Metric label="Active meters" value={String(new Set(rows.map((row) => row.meter)).size)} detail="Exact usage, never estimated" /></section><section className="panel"><div className="panel-heading with-action"><PanelHeading title="Usage ledger" subtitle="Grouped by meter, customer, and service." /><div><a className="export" href={`/api/v1/usage/export?from=${encodeURIComponent(from)}`}>Export CSV</a><a className="export" href={`/api/v1/usage/export?format=json&from=${encodeURIComponent(from)}`}>JSON</a></div></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Meter</th><th>Tenant</th><th>Service</th><th>Quantity</th><th>Unit</th><th>Events</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.meter}:${row.tenantId}:${index}`}><td className="primary">{row.meter}</td><td>{row.tenantId ?? "Unassigned"}</td><td>{row.service}</td><td>{format(row.quantity)}</td><td>{row.unit ?? "units"}</td><td>{row.events}</td></tr>)}</tbody></table></div> : <Empty />}</section></>; }

function HealthView({ rows }: { rows: Health[] }) { const latest = new Map<string, Health>(); for (const row of rows) latest.set(`${row.service}:${row.environment}`, row); return <section className="panel"><PanelHeading title="Service health" subtitle="Process and host context with restart detection." />{latest.size ? <div className="health-grid">{[...latest.values()].map((row) => <article className={`health-card ${row.restartDetected ? "restarted" : ""}`} key={`${row.service}:${row.environment}`}><div><i /><strong>{row.service}</strong><span>{row.environment} · PID {row.pid}{row.restartDetected ? " · restart detected" : ""}</span></div><dl><dt>CPU</dt><dd>{row.cpuPercent.toFixed(1)}%</dd><dt>RSS memory</dt><dd>{bytes(row.memoryRssBytes)}</dd><dt>Host free</dt><dd>{row.hostMemoryFreeBytes === undefined ? "—" : bytes(row.hostMemoryFreeBytes)}</dd><dt>Load (1m)</dt><dd>{row.hostLoad1m?.toFixed(2) ?? "—"}</dd><dt>Disk free</dt><dd>{row.diskFreeBytes === undefined ? "—" : bytes(row.diskFreeBytes)}</dd><dt>Event-loop lag</dt><dd>{row.eventLoopLagMs.toFixed(1)} ms</dd><dt>Uptime</dt><dd>{duration(row.uptimeSeconds)}</dd></dl></article>)}</div> : <Empty />}</section>; }

function OccurrenceDetail({ value, close }: { value: Record<string, any>; close(): void }) { const timeline = [...(value.events ?? []).map((item: any) => ({ ...item, kind: "event", durationMs: null })), ...(value.steps ?? []).map((item: any) => ({ ...item, kind: "step" })), ...(value.database?.operations ?? []).map((item: any) => ({ ...item, kind: "database", name: `${item.model}.${item.action}` })), ...(value.dependencies ?? []).map((item: any) => ({ ...item, kind: "dependency", name: `${item.method} ${item.host}${item.path}` }))].sort((a, b) => a.atMs - b.atMs); return <div className="overlay" onMouseDown={close}><article className="drawer" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={close} aria-label="Close">×</button><p className="eyebrow">Occurrence</p><h2>{value.operation}</h2><div className="detail-meta"><Status bad={value.status === "error"}>{value.status}</Status><span>{value.durationMs} ms</span><span>{value.service}</span><span>{new Date(value.startedAt).toLocaleString()}</span></div>{value.error ? <div className="error-stack"><strong>{value.error.type}: {value.error.message}</strong><pre>{value.error.stack}</pre></div> : null}<h3>Business context</h3><div className="chips">{Object.entries(value.context ?? {}).map(([key, item]) => <span key={key}>{key}<b>{String(item)}</b></span>)}</div><h3>Distributed operation tree</h3><DistributedTree occurrences={value.distributedOccurrences ?? [value]} currentId={value.id} /><h3>Local timeline</h3><div className="timeline">{timeline.length ? timeline.map((item) => <div key={item.id}><i className={item.kind} /><span>{item.atMs} ms</span><strong>{item.name}</strong><em>{item.durationMs === null ? item.kind : `${item.durationMs} ms`}</em></div>) : <p>No child activity was captured.</p>}</div><h3>Correlation</h3><code>{value.distributed?.traceId}</code></article></div>; }

function DistributedTree({ occurrences, currentId }: { occurrences: any[]; currentId: string }) {
  const bySpan = new Map(occurrences.map((item) => [item.distributed?.spanId, { item, children: [] as any[] }]));
  const roots: Array<{ item: any; children: any[] }> = [];
  for (const node of bySpan.values()) { const parent = bySpan.get(node.item.distributed?.parentId); if (parent) parent.children.push(node); else roots.push(node); }
  const render = (node: { item: any; children: any[] }, depth: number): React.ReactNode => <div className="trace-branch" key={node.item.id}><div className={`trace-node ${node.item.id === currentId ? "current" : ""}`} style={{ marginLeft: depth * 18 }}><Status bad={node.item.status === "error"}>{node.item.status}</Status><strong>{node.item.service}</strong><span>{node.item.operation}</span><em>{node.item.durationMs} ms</em></div>{node.children.map((child) => render(child, depth + 1))}</div>;
  return <div className="trace-tree">{roots.map((root) => render(root, 0))}</div>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) { return <article className={`metric ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="panel-heading"><h2>{title}</h2><p>{subtitle}</p></div>; }
function Status({ bad, children }: { bad: boolean; children: React.ReactNode }) { return <span className={`status ${bad ? "bad" : "good"}`}>{children}</span>; }
function Empty() { return <div className="empty"><Logo /><strong>No observed data yet</strong><p>Instrument one operation, exercise it, and it will appear here.</p></div>; }
function Loading() { return <div className="loading"><i /><span>Looking through the glass…</span></div>; }
function Logo() { return <svg className="logo" viewBox="0 0 42 42" aria-hidden="true"><path d="M9 3h24v7c0 5-3 7-5 10 2 3 5 5 5 12v7H9v-7c0-7 3-9 5-12-2-3-5-5-5-10V3Z"/><path className="liquid" d="M14 28c3-3 5-3 7-2 3 2 5 2 7-1v8H14v-5Z"/></svg>; }
function NavIcon({ label }: { label: string }) { return <span className="nav-icon">{label.slice(0, 1)}</span>; }
function format(value: number) { return new Intl.NumberFormat().format(value); }
function relative(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 1000)); if (seconds < 60) return `${seconds}s ago`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return new Date(value).toLocaleDateString(); }
function humanize(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function formatCell(value: unknown, column: string) { if (typeof value === "number" && column.toLowerCase().includes("ms")) return `${value} ms`; return value === null ? "—" : String(value); }
function bytes(value: number) { return `${(value / 1024 / 1024).toFixed(0)} MB`; }
function duration(seconds: number) { const hours = Math.floor(seconds / 3600); return hours > 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`; }
