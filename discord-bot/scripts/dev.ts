// `pnpm dev`: one copy of the bot for iterating, from any checkout. It uses the main checkout's
// .env (the test server), a database of its own, and writes its log to .logs/bot.log, emptied
// at each start so the file holds only this run.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const LOGS = ".logs"
mkdirSync(LOGS, { recursive: true })
process.env["LOG_FILE"] ??= join(LOGS, "bot.log")
process.env["DB_PATH"] ??= join(LOGS, "dev.sqlite")
writeFileSync(process.env["LOG_FILE"], "")

if (process.env["MULTIBALLS_ENV"] === undefined && !existsSync(".env")) {
  // A worktree: the secrets live in the main checkout, next to the shared .git directory.
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()
  process.env["MULTIBALLS_ENV"] = join(dirname(gitDir), "discord-bot", ".env")
}

await import("../src/main.js")
