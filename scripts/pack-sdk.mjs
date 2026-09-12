import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const destination = resolve("dist-packages");
mkdirSync(destination, { recursive: true });
for (const workspace of ["@bazokhan/sightglass-core", "@bazokhan/sightglass-express", "@bazokhan/sightglass-fastify", "@bazokhan/sightglass-nest", "@bazokhan/sightglass-next", "@bazokhan/sightglass-prisma"]) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable; run this command through npm");
  const result = spawnSync(process.execPath, [npmCli, "pack", "-w", workspace, "--pack-destination", destination], { stdio: "inherit", env: { ...process.env, npm_config_cache: resolve(".npm-cache") } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
