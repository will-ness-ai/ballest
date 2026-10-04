// `pnpm dev`: one copy of the bot for iterating, from any checkout. It uses the main checkout's
// .env (the test server), a database of its own, and writes its log to .logs/bot.log, emptied
// at each start so the file holds only this run. It also opens a Cloudflare quick tunnel for the dev
// Activity, prints its address for the dev app's URL Mapping, says once Discord serves the page
// through it, and closes it when the bot stops.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devEnvFile } from "./devEnv.js";

const LOGS = ".logs";
mkdirSync(LOGS, { recursive: true });
process.env.LOG_FILE ??= join(LOGS, "bot.log");
process.env.DB_PATH ??= join(LOGS, "dev.sqlite");
writeFileSync(process.env.LOG_FILE, "");
process.env.MULTIBALLS_ENV = devEnvFile();

/** How a check tells the Multiballs page from a tunnel's warning page. */
const PAGE_TITLE = "<title>Multiballs</title>";
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

/**
 * Ask Discord's proxy for the app (what the Activity's frame loads) every few seconds until it serves Multiballs, so whoever runs
 * the bot learns the URL Mapping took without relaunching the Activity. A browser's User-Agent,
 * because a tunnel's warning page (ngrok's free plan) shows only to browsers.
 */
const watchDiscord = (appId: string) => {
  const url = `https://${appId}.discordsays.com/`;
  const deadline = Date.now() + 15 * 60_000;
  let seen = "nothing yet";
  const check = async (): Promise<void> => {
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER } });
      const body = await res.text();
      if (res.ok && body.includes(PAGE_TITLE)) {
        console.log(`Discord serves the Activity (${url}): launch it.`);
        return;
      }
      seen = `${res.status} ${/<title>([^<]*)<\/title>/i.exec(body)?.[1] ?? "(no title)"}`;
    } catch (e) {
      seen = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() > deadline) {
      console.log(`Discord still doesn't serve the Activity at ${url}; last answer: ${seen}.`);
      return;
    }
    setTimeout(() => void check(), 5_000).unref();
  };
  void check();
};

/**
 * The dev Activity's tunnel: a Cloudflare quick tunnel, whose address is new on every start, so
 * it prints the address to paste into the dev app's URL Mapping.
 */
const openTunnel = () => {
  const envFile = process.env.MULTIBALLS_ENV ?? ".env";
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const port = process.env.PORT ?? /^PORT=(.+)$/m.exec(env)?.[1]?.trim() ?? "8080";
  const appId =
    process.env.DISCORD_APPLICATION_ID ?? /^DISCORD_APPLICATION_ID=(.+)$/m.exec(env)?.[1]?.trim();
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
    if (appId) watchDiscord(appId);
  });
  process.on("exit", () => tunnel.kill());
};
openTunnel();

await import("../src/main.js");
