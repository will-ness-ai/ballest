// The signed-in player's session (ADR 0008): one httpOnly cookie holding their Steam ID,
// when it was issued, and an HMAC of both under SESSION_SECRET, beside a readable hint
// cookie (lib/cookies.ts). Nothing else about the reader is kept. The routes under
// app/api/auth and app/api/me go through sessionOf and the response builders here; the
// secret and the clock are parameters so tests can pass their own.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { HINT_COOKIE, SESSION_COOKIE, STATE_COOKIE } from "./cookies";
import { isSteamId } from "./rules";
import { safeNext } from "./steam-openid";

export const SESSION_DAYS = 365;
const SESSION_MS = SESSION_DAYS * 86_400_000;
const STATE_SECONDS = 600;

const usable = (secret: string | undefined): secret is string => !!secret?.trim();
const mac = (body: string, secret: string) =>
  createHmac("sha256", secret.trim()).update(body).digest("base64url");

/* the cookie's value for `id`, issued at `now`; null with no secret configured */
export function sign(id: string, secret: string | undefined, now = Date.now()): string | null {
  if (!usable(secret) || !isSteamId(id)) return null;
  const body = `${id}.${Math.floor(now / 1000)}`;
  return `${body}.${mac(body, secret)}`;
}

/* the Steam ID a cookie value was signed for, or null when it is missing, altered,
   expired, or there is no secret to check it against */
export function verify(
  token: string | null | undefined,
  secret: string | undefined,
  now = Date.now(),
): string | null {
  if (!token || !usable(secret)) return null;
  const [id, issued, sig, ...rest] = token.split(".");
  if (rest.length || !isSteamId(id) || !/^\d{1,12}$/.test(issued) || !sig) return null;
  const want = Buffer.from(mac(`${id}.${issued}`, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const at = Number(issued) * 1000;
  return at <= now + 60_000 && now - at < SESSION_MS ? id : null;
}

/* one cookie's value from a request */
export function cookieOf(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/* who a request is signed in as. `stale` says it carries a session that doesn't verify
   under a configured secret, so the response should clear it; with no secret configured
   nothing is stale, so a deploy missing the variable signs nobody out for good */
export function sessionOf(
  request: Request,
  secret = process.env.SESSION_SECRET,
  now = Date.now(),
): { id: string | null; stale: boolean } {
  const token = cookieOf(request, SESSION_COOKIE);
  const id = verify(token, secret, now);
  return { id, stale: !!token && !id && usable(secret) };
}

const cookie = (name: string, value: string, age: number, httpOnly = true) =>
  `${name}=${value}; ${httpOnly ? "HttpOnly; " : ""}Path=/; Max-Age=${age}; Secure; SameSite=Lax`;

/* the Set-Cookie headers that sign `token` in, or (null) sign out */
export function sessionCookies(token: string | null): Array<string> {
  const age = token ? SESSION_DAYS * 86_400 : 0;
  return [
    cookie(SESSION_COOKIE, token ?? "", age),
    cookie(HINT_COOKIE, token ? "1" : "", age, false),
  ];
}

/* a fresh sign-in state and the cookie that holds it, or (null) the cookie that clears it */
export const newState = () => randomBytes(18).toString("base64url");
export const stateCookie = (state: string | null) =>
  cookie(STATE_COOKIE, state ?? "", state ? STATE_SECONDS : 0);

/* a 303 to the path `next` (or home), setting `cookies` */
export function redirectTo(next: string | null, cookies: Array<string> = []): Response {
  const headers = new Headers({ location: safeNext(next) });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}
