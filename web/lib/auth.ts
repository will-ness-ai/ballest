// Sign in with Steam, end to end (ADR 0008). Each route under app/api/auth and app/api/me is
// one call here, from a Request to its Response:
// - startSignIn: off to Steam's login, with a ten-minute state cookie for this browser;
// - finishSignIn: Steam's answer, checked by lib/steam-openid.ts, signs the browser in;
// - signOut: clears the session, from this site's own pages only;
// - whoIs: the signed-in Steam ID, for the browser's You (hooks/me.ts).
// The session is an httpOnly cookie holding the Steam ID, when it was issued and an HMAC of
// both under SESSION_SECRET, beside a readable hint cookie (lib/cookies.ts). Nothing else
// about the reader is kept. `env` lets tests pass their own secret, clock and Steam.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { HINT_COOKIE, SESSION_COOKIE, STATE_COOKIE } from "./cookies";
import { isSteamId } from "./rules";
import { loginUrl, safeNext, verifyReturn } from "./steam-openid";

const DAY_SECONDS = 86_400;
const SESSION_SECONDS = 365 * DAY_SECONDS;
const STATE_SECONDS = 600;

export interface AuthEnv {
  secret?: string;
  now?: number;
  steam?: typeof fetch;
}
const envOf = (env: AuthEnv) => ({
  secret: env.secret ?? process.env.SESSION_SECRET,
  now: env.now ?? Date.now(),
  steam: env.steam ?? fetch,
});

/* GET /api/auth/steam?next=<path> */
export function startSignIn(request: Request): Response {
  const url = new URL(request.url);
  const state = randomBytes(18).toString("base64url");
  const to = loginUrl(url.origin, url.searchParams.get("next") ?? "/", state);
  return new Response(null, {
    status: 302,
    headers: { location: to, "set-cookie": cookie(STATE_COOKIE, state, STATE_SECONDS) },
  });
}

/* GET /api/auth/steam/return: signed in when Steam confirms the login for the browser that
   started it; as it was otherwise (cancelled, forged, replayed, Steam unreachable, no
   secret). Either way the state is spent and the reader lands on the page they left */
export async function finishSignIn(request: Request, env: AuthEnv = {}): Promise<Response> {
  const { secret, now, steam } = envOf(env);
  const url = new URL(request.url);
  const id = await verifyReturn(url, cookieOf(request, STATE_COOKIE), steam, now);
  const token = id && sign(id, secret, now);
  return redirectTo(url.searchParams.get("next"), [
    cookie(STATE_COOKIE, "", 0),
    ...(token ? sessionCookies(token) : []),
  ]);
}

/* POST /api/auth/signout?next=<path>: another site can't post a reader out */
export function signOut(request: Request): Response {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== url.origin))
    return Response.json({ error: "cross-site" }, { status: 403 });
  return redirectTo(url.searchParams.get("next"), sessionCookies(null));
}

/* GET /api/me: { id } or { id: null }, never cached. A session that doesn't verify under a
   configured secret is cleared, so the browser stops asking; with no secret configured it
   is kept, so a deploy missing the variable signs nobody out for good */
export function whoIs(request: Request, env: AuthEnv = {}): Response {
  const { secret, now } = envOf(env);
  const token = cookieOf(request, SESSION_COOKIE);
  const id = verify(token, secret, now);
  const headers = new Headers({ "cache-control": "private, no-store" });
  if (token && !id && usable(secret))
    for (const c of sessionCookies(null)) headers.append("set-cookie", c);
  return Response.json({ id }, { headers });
}

const usable = (secret: string | undefined): secret is string => !!secret?.trim();
const mac = (body: string, secret: string) =>
  createHmac("sha256", secret.trim()).update(body).digest("base64url");

/* the session cookie's value for `id`; null with no secret configured */
function sign(id: string, secret: string | undefined, now: number): string | null {
  if (!usable(secret) || !isSteamId(id)) return null;
  const body = `${id}.${Math.floor(now / 1000)}`;
  return `${body}.${mac(body, secret)}`;
}

/* the Steam ID a session was signed for, or null when it is missing, altered, expired,
   from the future, or there is no secret to check it against */
function verify(token: string | null, secret: string | undefined, now: number): string | null {
  if (!token || !usable(secret)) return null;
  const [id, issued, sig, ...rest] = token.split(".");
  if (rest.length || !isSteamId(id) || !/^\d{1,12}$/.test(issued) || !sig) return null;
  const want = Buffer.from(mac(`${id}.${issued}`, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const age = now / 1000 - Number(issued);
  return age >= -60 && age < SESSION_SECONDS ? id : null;
}

function cookieOf(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

const cookie = (name: string, value: string, age: number, httpOnly = true) =>
  `${name}=${value}; ${httpOnly ? "HttpOnly; " : ""}Path=/; Max-Age=${age}; Secure; SameSite=Lax`;

/* the session and hint cookies that sign `token` in, or (null) sign out */
const sessionCookies = (token: string | null) => [
  cookie(SESSION_COOKIE, token ?? "", token ? SESSION_SECONDS : 0),
  cookie(HINT_COOKIE, token ? "1" : "", token ? SESSION_SECONDS : 0, false),
];

function redirectTo(next: string | null, cookies: Array<string>): Response {
  const headers = new Headers({ location: safeNext(next) });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}
