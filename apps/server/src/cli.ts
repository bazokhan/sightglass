import { copyFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { Store } from "./database.js";
import { verifyBackup } from "./operations.js";
import { Security } from "./security.js";

const [command, argument] = process.argv.slice(2);
if (command === "backup") {
  const source = new Store(config.databasePath); const destination = resolve(argument ?? `sightglass-backup-${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
  await backup(source.database, destination); source.database.close(); verifyBackup(destination); console.log(destination);
} else if (command === "verify-backup") {
  if (!argument) usage(); verifyBackup(resolve(argument!)); console.log("Backup is valid.");
} else if (command === "restore") {
  if (!argument) usage(); const source = resolve(argument!); verifyBackup(source);
  const candidate = new DatabaseSync(source, { readOnly: true }); const candidateVersion = Number((candidate.prepare("SELECT COALESCE(MAX(version),0) version FROM schema_migrations").get() as { version: number }).version); candidate.close();
  const current = new Store(config.databasePath); const currentVersion = current.schemaVersion(); current.database.close();
  if (candidateVersion > currentVersion) throw new Error(`Backup schema ${candidateVersion} is newer than supported schema ${currentVersion}.`);
  const safety = `${config.databasePath}.before-restore-${Date.now()}`; if (existsSync(config.databasePath)) renameSync(config.databasePath, safety);
  removeSidecars();
  try { copyFileSync(source, config.databasePath); const restored = new Store(config.databasePath); restored.database.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)"); restored.database.close(); removeSidecars(); console.log(`Restored ${source}. Previous database: ${safety}`); }
  catch (error) { if (existsSync(safety)) copyFileSync(safety, config.databasePath); throw error; }
} else if (command === "setup-link") {
  const store = new Store(config.databasePath); const security = new Security(store.database); console.log(security.createSetupLink()); store.database.close();
} else usage();

function usage(): never { console.error("Usage: cli.js backup [path] | verify-backup <path> | restore <path> | setup-link"); process.exit(2); }
function removeSidecars(): void { for (const suffix of ["-wal", "-shm"]) { const path = `${config.databasePath}${suffix}`; if (existsSync(path)) unlinkSync(path); } }
