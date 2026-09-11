import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const documents = ["README.md", "docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/PROTOCOL.md", "docs/API.md", "docs/OPERATIONS.md", "docs/BENCHMARKS.md", "docs/benchmarks/LATEST.md", "docs/COMPARISON.md", "docs/STATUS.md"];

describe("documentation", () => {
  it("keeps every relative Markdown link valid", () => {
    const missing: string[] = [];
    for (const document of documents) {
      const content = readFileSync(resolve(document), "utf8");
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1]!;
        if (/^(?:https?:|#)/.test(target)) continue;
        const path = resolve(dirname(document), target.split("#")[0]!);
        if (!existsSync(path)) missing.push(`${document} -> ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("documents every public SDK configuration option in the dashboard", () => {
    const types = readFileSync(resolve("packages/core/src/types.ts"), "utf8"); const dashboard = readFileSync(resolve("apps/dashboard/src/Docs.tsx"), "utf8");
    const block = types.match(/export interface SightglassConfig \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const options = [...block.matchAll(/^\s+([A-Za-z][A-Za-z0-9]+)\??:/gm)].map((match) => match[1]!);
    expect(options.filter((option) => !dashboard.includes(`["${option}"`))).toEqual([]);
  });

  it("keeps benchmark evidence reproducible and dashboard-ready", () => {
    const result = JSON.parse(readFileSync(resolve("docs/benchmarks/latest.json"), "utf8")) as { methodology: { deterministicFixture: boolean; settings: { iterations: number; queryIterations: number } }; throughput: Array<{ statistics: { samples: number[] } }>; queryLatency: Array<{ statistics: { samples: number[] } }> };
    expect(result.methodology.deterministicFixture).toBe(true);
    expect(result.methodology.settings.iterations).toBeGreaterThanOrEqual(5);
    expect(result.methodology.settings.queryIterations).toBeGreaterThanOrEqual(30);
    expect(result.throughput.every((item) => item.statistics.samples.length === result.methodology.settings.iterations)).toBe(true);
    expect(result.queryLatency.every((item) => item.statistics.samples.length === result.methodology.settings.queryIterations)).toBe(true);
    expect(existsSync(resolve("docs/assets/benchmarks/throughput.svg"))).toBe(true);
    expect(existsSync(resolve("docs/assets/benchmarks/query-latency.svg"))).toBe(true);
    expect(existsSync(resolve("apps/dashboard/src/benchmark-results.ts"))).toBe(true);
  });

  it("compares Sightglass with exactly ten named alternatives and official sources", () => {
    const dashboard = readFileSync(resolve("apps/dashboard/src/Docs.tsx"), "utf8");
    const competitors = ["Datadog APM", "New Relic", "Honeycomb", "Grafana", "Sentry", "Dynatrace", "SigNoz", "Better Stack", "Elastic Observability", "Uptrace"];
    expect(competitors.filter((name) => !dashboard.includes(`name: "${name}"`))).toEqual([]);
    expect((dashboard.match(/name: "(?:Datadog APM|New Relic|Honeycomb|Grafana|Sentry|Dynatrace|SigNoz|Better Stack|Elastic Observability|Uptrace)"/g) ?? []).length).toBe(10);
    expect(readFileSync(resolve("docs/COMPARISON.md"), "utf8")).toContain("## Official sources");
  });
});
