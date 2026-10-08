// The signed-in player's session (ADR 0008): one httpOnly cookie holding their Steam ID,
// when it was issued, and an HMAC of both under SESSION_SECRET. Nothing else about the
// reader is kept. A second, readable cookie says only that a session exists, so the
// browser can hold You's place without asking /api/me first, and skip asking at all when
// nobody is signed in.
import { createHmac, timingSafeEqual } from "node:crypto";

import { isSteamId } from "./rules";

export const SESSION_COOKIE = "ballest-session";
export const HINT_COOKIE = "ballest-in";
export const SESSION_DAYS = 365;
const SESSION_MS = SESSION_DAYS * 86_400_000;

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

/* one cookie's value from a Cookie header */
export function cookieOf(header: string | null, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/* the Set-Cookie headers that sign `token` in, or (null) sign out */
export function sessionCookies(token: string | null): Array<string> {
  const age = token ? SESSION_DAYS * 86_400 : 0;
  const tail = `Path=/; Max-Age=${age}; Secure; SameSite=Lax`;
  return [
    `${SESSION_COOKIE}=${token ?? ""}; HttpOnly; ${tail}`,
    `${HINT_COOKIE}=${token ? "1" : ""}; ${tail}`,
  ];
}
