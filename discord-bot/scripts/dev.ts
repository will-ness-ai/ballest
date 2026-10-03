// `pnpm dev`: one copy of the bot for iterating, from any checkout. It uses the main checkout's
// .env (the test server), a database of its own, and writes its log to .logs/bot.log, emptied
// at each start so the file holds only this run.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devEnvFile } from "./devEnv.js";

const LOGS = ".logs";
mkdirSync(LOGS, { recursive: true });
process.env.LOG_FILE ??= join(LOGS, "bot.log");
process.env.DB_PATH ??= join(LOGS, "dev.sqlite");
writeFileSync(process.env.LOG_FILE, "");
process.env.MULTIBALLS_ENV = devEnvFile();

await import("../src/main.js");
