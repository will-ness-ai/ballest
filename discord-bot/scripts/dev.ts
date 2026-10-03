// `pnpm dev`: one copy of the bot for iterating, from any checkout. It uses the main checkout's
// .env (the test server), a database of its own, and writes its log to .logs/bot.log, emptied
// at each start so the file holds only this run. With NGROK_DOMAIN in that .env (set by
// scripts/ngrok-wizard.sh), it also opens the dev Activity's tunnel on that fixed address, which
// the dev app's URL Mapping points at, and closes it when the bot stops.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LOGS = ".logs";
mkdirSync(LOGS, { recursive: true });
process.env.LOG_FILE ??= join(LOGS, "bot.log");
process.env.DB_PATH ??= join(LOGS, "dev.sqlite");
writeFileSync(process.env.LOG_FILE, "");

if (process.env.MULTIBALLS_ENV === undefined && !existsSync(".env")) {
  // A worktree: the secrets live in the main checkout, next to the shared .git directory.
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  process.env.MULTIBALLS_ENV = join(dirname(gitDir), "discord-bot", ".env");
}

/** The dev Activity's tunnel, when the .env names a fixed ngrok domain. */
const openTunnel = () => {
  const envFile = process.env.MULTIBALLS_ENV ?? ".env";
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const domain = process.env.NGROK_DOMAIN ?? /^NGROK_DOMAIN=(.+)$/m.exec(env)?.[1]?.trim();
  if (!domain) {
    console.log(
      "No NGROK_DOMAIN: the Activity has no tunnel. Run scripts/ngrok-wizard.sh to give it one.",
    );
    return;
  }
  const port = process.env.PORT ?? /^PORT=(.+)$/m.exec(env)?.[1]?.trim() ?? "8080";
  const tunnel = spawn("ngrok", ["http", `--url=${domain}`, port, "--log=false"], {
    stdio: "ignore",
  });
  tunnel.on("error", (e) =>
    console.log(`The Activity's tunnel didn't start (${e.message}). Is ngrok installed?`),
  );
  tunnel.on("spawn", () =>
    console.log(`The Activity is at https://${domain} (ngrok to port ${port}).`),
  );
  process.on("exit", () => tunnel.kill());
};
openTunnel();

await import("../src/main.js");
