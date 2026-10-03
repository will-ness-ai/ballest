// `pnpm dev`: one copy of the bot for iterating, from any checkout. It uses the main checkout's
// .env (the test server), a database of its own, and writes its log to .logs/bot.log, emptied
// at each start so the file holds only this run. When this PC is on Tailscale (set up by
// scripts/tailscale-wizard.sh), it also opens the dev Activity's Funnel on this PC's fixed
// address, which the dev app's URL Mapping points at, and closes it when the bot stops.
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

/** The dev Activity's tunnel: this PC's fixed Tailscale Funnel address, when it has one. */
const openTunnel = () => {
  let host: string | undefined;
  try {
    const status = JSON.parse(
      execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" }),
    ) as {
      Self?: { DNSName?: string };
    };
    host = status.Self?.DNSName?.replace(/\.$/, "");
  } catch {
    // Not installed or not signed in: the hint below covers both.
  }
  if (!host) {
    console.log(
      "No Tailscale: the Activity has no tunnel. Run scripts/tailscale-wizard.sh to give it one.",
    );
    return;
  }
  const envFile = process.env.MULTIBALLS_ENV ?? ".env";
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const port = process.env.PORT ?? /^PORT=(.+)$/m.exec(env)?.[1]?.trim() ?? "8080";
  const tunnel = spawn("tailscale", ["funnel", port], { stdio: "ignore" });
  tunnel.on("error", (e) => console.log(`The Activity's tunnel didn't start (${e.message}).`));
  tunnel.on("spawn", () =>
    console.log(`The Activity is at https://${host} (Tailscale Funnel to port ${port}).`),
  );
  process.on("exit", () => tunnel.kill());
};
openTunnel();

await import("../src/main.js");
