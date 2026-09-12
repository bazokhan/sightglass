import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const names = ["core", "express", "fastify", "nest", "next", "prisma"];
const manifests = names.map((name) => {
  const file = resolve("packages", name, "package.json");
  return { name, file, value: JSON.parse(readFileSync(file, "utf8")) };
});
const versions = new Set(manifests.map(({ value }) => value.version));
if (versions.size !== 1) throw new Error(`SDK versions are not synchronized: ${[...versions].join(", ")}`);

for (const { name, value } of manifests) {
  if (value.private) throw new Error(`${value.name} is private`);
  if (value.publishConfig?.access !== "public") throw new Error(`${value.name} is not configured for public publishing`);
  if (value.repository?.url !== "git+https://github.com/bazokhan/sightglass.git") throw new Error(`${value.name} has an incorrect repository URL`);
  if (!existsSync(resolve("packages", name, "dist", "index.js")) || !existsSync(resolve("packages", name, "dist", "index.d.ts"))) {
    throw new Error(`${value.name} has not been built`);
  }
}

for (const { value } of manifests.filter(({ name }) => name !== "core")) {
  if (value.dependencies?.["@sightglass/core"] !== value.version) {
    throw new Error(`${value.name} must depend on @sightglass/core ${value.version}`);
  }
}

globalThis.console.log(`Validated ${manifests.length} public SDK packages at ${[...versions][0]}.`);
