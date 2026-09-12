import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sdkNames = ["core", "express", "fastify", "nest", "next", "prisma"];

describe("distribution documentation", () => {
  it("links consumers to the canonical public documentation repository", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");
    expect(readme).toContain("sightglass-docs.vercel.app");
    expect(readme).toContain("github.com/bazokhan/sightglass-docs");
    expect(readme).not.toContain("docs/PRODUCT.md");
  });

  it("keeps every public SDK synchronized and publishable", () => {
    const manifests = sdkNames.map((name) => JSON.parse(readFileSync(resolve("packages", name, "package.json"), "utf8")) as { name: string; version: string; publishConfig?: { access?: string }; repository?: { url?: string }; dependencies?: Record<string, string> });
    expect(new Set(manifests.map((manifest) => manifest.version)).size).toBe(1);
    for (const manifest of manifests) {
      expect(manifest.publishConfig?.access).toBe("public");
      expect(manifest.repository?.url).toBe("git+https://github.com/bazokhan/sightglass.git");
    }
  });

  it("keeps consumer docs outside the private dashboard bundle", () => {
    const app = readFileSync(resolve("apps/dashboard/src/App.tsx"), "utf8");
    expect(app).not.toContain("DocsView");
    expect(app).toContain("sightglass-docs.vercel.app/docs");
  });
});
