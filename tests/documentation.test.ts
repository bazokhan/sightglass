import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const documents = ["README.md", "docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/PROTOCOL.md", "docs/API.md", "docs/OPERATIONS.md", "docs/BENCHMARKS.md", "docs/STATUS.md"];

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
});
