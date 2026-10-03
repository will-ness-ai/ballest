// `pnpm dev`: one copy of the bot for iterating, from any checkout. It uses the main checkout's
// .env (the test server), a database of its own, and writes its log to .logs/bot.log, emptied
// at each start so the file holds only this run. It also opens a Cloudflare quick tunnel for the dev
// Activity, prints its address for the dev app's URL Mapping, and closes it when the bot stops.
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

/**
 * The dev Activity's tunnel: a Cloudflare quick tunnel, whose address is new on every start, so
 * it prints the address to paste into the dev app's URL Mapping.
 */
const openTunnel = () => {
  const envFile = process.env.MULTIBALLS_ENV ?? ".env";
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const port = process.env.PORT ?? /^PORT=(.+)$/m.exec(env)?.[1]?.trim() ?? "8080";
  // winget's install isn't always on PATH in a terminal opened before it.
  const installed = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
  const cloudflared = existsSync(installed) ? installed : "cloudflared";
  const tunnel = spawn(cloudflared, ["tunnel", "--url", `http://localhost:${port}`], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  tunnel.on("error", (e) =>
    console.log(
      `The Activity's tunnel didn't start (${e.message}). Install cloudflared: winget install Cloudflare.cloudflared`,
    ),
  );
  let found = false;
  tunnel.stderr.on("data", (chunk: Buffer) => {
    const host = found
      ? undefined
      : /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/.exec(String(chunk))?.[1];
    if (!host) return;
    found = true;
    console.log(
      `\nThe Activity's tunnel is up. Set the dev app's URL Mapping for / to:\n\n    ${host}\n\n` +
        "(Developer Portal, Multiballs (dev), Activities, URL Mappings; no https://.)\n",
    );
  });
  process.on("exit", () => tunnel.kill());
};
openTunnel();

await import("../src/main.js");
