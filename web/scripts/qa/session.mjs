// Signs qa's browser in as a player, so it can draw what only a signed-in player sees (a
// catalogue row's `as`). It writes the session cookie lib/auth.ts would set after Steam's
// login, under the target's SESSION_SECRET, which qa knows only for a local build;
// test/qa-session.test.ts keeps the two cookies the same.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { IDS, PAGES } from "./catalogue.mjs";

/**
 * How qa signs target `t`'s browser in to draw catalogue page `page`: the cookies to set,
 * and `as`, the Steam ID the site should then answer /api/me with (undefined for a page
 * drawn signed out, which needs no cookies). Null when `t` can't sign the page in: no
 * secret known for it, or no such player in its ID set.
 */
export function signIn(page, t, now) {
  const as = PAGES.find((x) => x.name === page)?.as;
  if (!as) return { as: undefined, cookies: [] };
  const id = IDS[t.ids][as];
  return id && t.secret ? { as: id, cookies: signedIn(t.url, id, t.secret, now) } : null;
}

// lib/cookies.ts's names, which a plain Node script can't import
export const SESSION_COOKIE = "ballest-session";
export const HINT_COOKIE = "ballest-in";

/* the cookies that sign a browser on `url`'s site in as `id`, for Playwright's addCookies */
export const signedIn = (url, id, secret, now) => [
  { name: SESSION_COOKIE, value: sessionCookie(id, secret, now), url, httpOnly: true },
  { name: HINT_COOKIE, value: "1", url },
];

/* the session cookie's value for `id`, as lib/auth.ts signs it */
export function sessionCookie(id, secret, now) {
  const body = `${id}.${String(Math.floor(now / 1000))}`;
  return `${body}.${createHmac("sha256", secret.trim()).update(body).digest("base64url")}`;
}

// the secret `pnpm serve` and `pnpm dev:up` serve under when none is configured, the one CI's
// qa run uses (web.yml)
export const QA_SECRET = "qa-only";

const WEB = fileURLToPath(new URL("../..", import.meta.url));
// the .env files Next reads for `next start` and `next dev`, first wins; qa can't tell which
// one a local target runs, so it reads them all, the shared ones first
const ENV_FILES = {
  production: [".env.production.local", ".env.local", ".env.production", ".env"],
  development: [".env.development.local", ".env.local", ".env.development", ".env"],
  any: [
    ".env.local",
    ".env.production.local",
    ".env.development.local",
    ".env.production",
    ".env.development",
    ".env",
  ],
};

/**
 * The SESSION_SECRET configured for a local build in `mode` (production, development, or
 * any): the environment's, else the first of web/'s .env files Next reads that sets one.
 * Null when none does.
 * @param {{ SESSION_SECRET?: string }} [env]
 * @param {string} [dir]
 * @param {"production" | "development" | "any"} [mode]
 */
export function configuredSecret(env = process.env, dir = WEB, mode = "any") {
  if (env.SESSION_SECRET?.trim()) return env.SESSION_SECRET;
  for (const name of ENV_FILES[mode]) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    const m = /^SESSION_SECRET=(.*)$/m.exec(readFileSync(file, "utf8"));
    const secret = m?.[1].trim().replace(/^["']|["']$/g, "");
    if (secret) return secret;
  }
  return null;
}

/**
 * The secret qa signs a local target's sessions with: the configured one, or else qa-only
 * with `fallback`, which only a server started by `pnpm serve` or `pnpm dev:up` takes.
 * @param {{ SESSION_SECRET?: string }} [env]
 * @param {string} [dir]
 */
export function localSecret(env = process.env, dir = WEB) {
  const secret = configuredSecret(env, dir);
  return secret ? { secret, fallback: false } : { secret: QA_SECRET, fallback: true };
}
