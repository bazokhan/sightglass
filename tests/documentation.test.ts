import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sdkNames = ["core", "express", "fastify", "nest", "next", "prisma"];
const docsOrigin = "https://sightglass-docs.trugraph.io";

describe("distribution documentation", () => {
  it("links consumers to the canonical public documentation repository", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");
    expect(readme).toContain(docsOrigin);
    expect(readme).toContain("github.com/bazokhan/sightglass-docs");
    expect(readme).toContain("hub.docker.com/r/bazokhan/sightglass");
    for (const name of sdkNames) expect(readme).toContain(`npmjs.com/package/@bazokhan/sightglass-${name}`);
    expect(readme).not.toContain("vercel.app");
    expect(readme).not.toContain("docs/PRODUCT.md");
  });

  it("keeps every public SDK synchronized and publishable", () => {
    const manifests = sdkNames.map((name) => JSON.parse(readFileSync(resolve("packages", name, "package.json"), "utf8")) as { name: string; version: string; homepage?: string; publishConfig?: { access?: string }; repository?: { url?: string }; dependencies?: Record<string, string> });
    expect(new Set(manifests.map((manifest) => manifest.version)).size).toBe(1);
    for (const manifest of manifests) {
      expect(manifest.publishConfig?.access).toBe("public");
      expect(manifest.repository?.url).toBe("git+https://github.com/bazokhan/sightglass.git");
      expect(manifest.homepage).toBe(`${docsOrigin}/docs`);
    }
    for (const name of sdkNames) {
      const packageReadme = readFileSync(resolve("packages", name, "README.md"), "utf8");
      expect(packageReadme).toContain(docsOrigin);
      expect(packageReadme).not.toContain("vercel.app");
    }
  });

  it("keeps consumer docs outside the private dashboard bundle", () => {
    const app = readFileSync(resolve("apps/dashboard/src/App.tsx"), "utf8");
    expect(app).not.toContain("DocsView");
    expect(app).toContain(`${docsOrigin}/docs`);
    expect(app).not.toContain("vercel.app");
  });

  it("publishes canonical documentation metadata with the Docker image", () => {
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
    expect(dockerfile).toContain(`org.opencontainers.image.url="${docsOrigin}"`);
    expect(dockerfile).toContain(`org.opencontainers.image.documentation="${docsOrigin}/docs"`);
  });
});
