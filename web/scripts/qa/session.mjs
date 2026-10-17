// Signs qa's browser in as a player, so it can draw what only a signed-in player sees (a
// catalogue row's `as`). It writes the session cookie lib/auth.ts would set after Steam's
// login, under the target's SESSION_SECRET, which qa knows only for a local build;
// test/qa-session.test.ts keeps the two cookies the same.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

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

/* the secret a local build signs sessions with: SESSION_SECRET, or web/.env.local's */
export function localSecret() {
  if (process.env.SESSION_SECRET?.trim()) return process.env.SESSION_SECRET;
  const file = new URL("../../.env.local", import.meta.url);
  if (!existsSync(file)) return null;
  const m = /^SESSION_SECRET=(.*)$/m.exec(readFileSync(file, "utf8"));
  return m?.[1].trim().replace(/^["']|["']$/g, "") || null;
}
