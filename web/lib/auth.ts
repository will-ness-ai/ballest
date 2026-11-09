// Sign in with Steam, end to end (ADR 0008). Each route under app/api/auth and app/api/me is
// one call here, from a Request to its Response:
// - startSignIn: off to Steam's login, with a ten-minute state cookie for this browser;
// - finishSignIn: Steam's answer, checked by lib/steam-openid.ts, signs the browser in;
// - signOut: clears the session, from this site's own pages only;
// - whoIs: the signed-in Steam ID, for the browser's You (hooks/me.ts);
// - signInFromGame: a Steam ticket from the player's running game, checked by
//   lib/steam-ticket.ts, answers a game token (ADR 0016);
// - startAppSignIn, finishAppSignIn, signInFromApp: a desktop app's player signs in through
//   their browser, back to the app with a code it trades for an app token (ADR 0017);
// - sessionOf and isCrossSite: who sent a request that writes (ADR 0009), and whether another
//   site sent it; prefabSessionOf, the same for the Prefab API, which also takes the game's
//   token; sessionOfCookie, who reads the link page (ADR 0014).
// The session is an httpOnly cookie holding the Steam ID, when it was issued and an HMAC of
// both under SESSION_SECRET, beside a readable hint cookie (lib/cookies.ts). The game token
// is the same with `game` signed in, sent as `Authorization: Bearer`, good for a day and only
// on the Prefab API: never as a cookie, never for the admin. The app token is the same again
// with `app` signed in, good for 30 days. Nothing else about the reader is
// kept. `env` lets tests pass their own secret, clock, Steam, Web API key and sign-in limit.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  APP_RETURN_PATH,
  appRequestOf,
  callbackOf,
  codeFor,
  idOfTrade,
  tradeOf,
  type AppRequest,
} from "./app-sign-in";
import { APP_STATE_COOKIE, HINT_COOKIE, SESSION_COOKIE, STATE_COOKIE } from "./cookies";
import { isSteamId } from "./rules";
import { loginUrl, loginUrlBack, safeNext, verifyReturn } from "./steam-openid";
import { isTicket, verifyTicket } from "./steam-ticket";

const DAY_SECONDS = 86_400;
const SESSION_SECONDS = 365 * DAY_SECONDS;
/* the game signs in afresh each time it starts, and again on a 401, so a day is plenty and
   a token copied out of it is soon useless */
export const GAME_SESSION_SECONDS = DAY_SECONDS;
/* an app's sign-in is a trip through the browser, so it lasts a month (ADR 0017) */
export const APP_SESSION_SECONDS = 30 * DAY_SECONDS;
const STATE_SECONDS = 600;
/* every sign-in answer is the reader's alone */
const NO_STORE = { "cache-control": "private, no-store" };
const refuse = (error: string, status: number, headers: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } });

/* a browser's cookie, the game's bearer token (ADR 0016), or an app's (ADR 0017) */
type SessionKind = "browser" | "game" | "app";
const LIFE: Record<SessionKind, number> = {
  browser: SESSION_SECONDS,
  game: GAME_SESSION_SECONDS,
  app: APP_SESSION_SECONDS,
};

export interface AuthEnv {
  secret?: string;
  now?: number;
  steam?: typeof fetch;
  steamKey?: string;
  /* whether the game, or an app trading its code, may sign in from where this request came,
     counting it if so; the routes pass the per-address limit (db/game-sign-in.ts), and
     without one there is none */
  allowGameSignIn?: (request: Request) => Promise<boolean>;
}
const envOf = (env: AuthEnv) => ({
  secret: env.secret ?? process.env.SESSION_SECRET,
  now: env.now ?? Date.now(),
  steam: env.steam ?? fetch,
  steamKey: env.steamKey ?? process.env.STEAM_API_KEY,
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
  if (isCrossSite(request)) return Response.json({ error: "cross-site" }, { status: 403 });
  return redirectTo(new URL(request.url).searchParams.get("next"), sessionCookies(null));
}

/* POST /api/auth/steam/ticket with { ticket }: the game signs its player in (ADR 0016). Steam
   says whose the ticket is, and the answer is { id, token, expiresIn }: a game token for the
   game to send as `Authorization: Bearer`, good for `expiresIn` seconds. No cookie is set.
   Refused from another site, with no secret or Web API key configured, for something that
   isn't a ticket, past the address's hourly limit (before Steam is asked), or for a ticket
   Steam doesn't accept */
export async function signInFromGame(request: Request, env: AuthEnv = {}): Promise<Response> {
  if (isCrossSite(request)) return refuse("cross-site", 403);
  const { secret, now, steam, steamKey } = envOf(env);
  if (!usable(secret) || !steamKey?.trim())
    return refuse("sign-in from the game isn't set up", 503);
  const sent: unknown = await request.json().catch(() => null);
  const ticket =
    typeof sent === "object" && sent !== null ? (sent as { ticket?: unknown }).ticket : null;
  if (!isTicket(ticket)) return refuse("that isn't a Steam ticket", 400);
  if (env.allowGameSignIn && !(await env.allowGameSignIn(request)))
    return refuse("too many sign-ins from here; try again later", 429);
  const checked = await verifyTicket(ticket, steamKey.trim(), steam);
  if (!checked.ok) return refuse(checked.error, checked.status);
  return Response.json(
    {
      id: checked.id,
      token: sign(checked.id, secret, now, "game"),
      expiresIn: GAME_SESSION_SECONDS,
    },
    { headers: NO_STORE },
  );
}

/* GET /api/auth/app?redirect_uri=&state=&code_challenge=: a desktop app's player off to
   Steam's login, coming back through /api/auth/app/return with the app's request, and the
   a ten-minute state cookie of its own for this browser. A request that doesn't
   check (lib/app-sign-in.ts appRequestOf) answers 400 and never sends the browser anywhere */
export function startAppSignIn(request: Request): Response {
  const url = new URL(request.url);
  const asked = appRequestOf(url.searchParams);
  if (!asked)
    return refuse(
      "redirect_uri is http://127.0.0.1 or http://[::1], state 1-200 URL-safe characters, " +
        "code_challenge a SHA-256 in base64url (S256)",
      400,
    );
  const state = randomBytes(18).toString("base64url");
  const to = loginUrlBack(url.origin, APP_RETURN_PATH, { ...appParams(asked), state });
  return new Response(null, {
    status: 302,
    headers: { location: to, "set-cookie": cookie(APP_STATE_COOKIE, state, STATE_SECONDS) },
  });
}

/* GET /api/auth/app/return: Steam's answer, checked as the site's own is. The app's request is
   read from the return address Steam signed; the browser goes back to the app with a code
   when Steam confirms the login for this browser, else with error=access_denied (cancelled,
   forged, replayed, Steam unreachable, no secret). Either way the state is spent and no
   session cookie is set: the browser isn't signed in to the site by it */
export async function finishAppSignIn(request: Request, env: AuthEnv = {}): Promise<Response> {
  const { secret, now, steam } = envOf(env);
  const url = new URL(request.url);
  const signed = URL.parse(url.searchParams.get("openid.return_to") ?? "");
  /* only a return to here carries an app's request: anything else is sent nowhere */
  const here = signed?.origin === url.origin && signed.pathname === APP_RETURN_PATH;
  const asked = here && appRequestOf(signed.searchParams, "app_state");
  const clear = cookie(APP_STATE_COOKIE, "", 0);
  if (!asked) return refuse("not an app's sign-in", 400, { "set-cookie": clear });
  const state = cookieOf(request, APP_STATE_COOKIE);
  const id = await verifyReturn(url, state, steam, now, APP_RETURN_PATH);
  /* the app's values must be the ones Steam signed, not ones added beside them */
  const same = Object.entries(appParams(asked)).every(([k, v]) => url.searchParams.get(k) === v);
  const answer: Record<string, string> =
    id && same && usable(secret)
      ? { code: codeFor(id, asked.challenge, secret, now), state: asked.state }
      : { error: "access_denied", state: asked.state };
  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE,
      location: callbackOf(asked.redirect, answer),
      "set-cookie": clear,
    },
  });
}

/* POST /api/auth/app/token with { code, code_verifier }: the app trades the code its browser
   brought back, with the secret behind its challenge, for { id, token, expiresIn }: an app
   token to send as `Authorization: Bearer`, good for `expiresIn` seconds. No cookie is set.
   Refused from another site, with no secret configured, for a body not shaped like a trade
   (counting nothing), past the address's hourly sign-in limit (the game's), or for a code that
   is altered, run out or not this verifier's */
export async function signInFromApp(request: Request, env: AuthEnv = {}): Promise<Response> {
  if (isCrossSite(request)) return refuse("cross-site", 403);
  const { secret, now } = envOf(env);
  if (!usable(secret)) return refuse("sign-in from an app isn't set up", 503);
  const trade = tradeOf(await request.json().catch(() => null));
  if (!trade) return refuse("send { code, code_verifier } as the sign-in gave them", 400);
  if (env.allowGameSignIn && !(await env.allowGameSignIn(request)))
    return refuse("too many sign-ins from here; try again later", 429);
  const id = idOfTrade(trade, secret, now);
  if (!id) return refuse("invalid_grant", 400);
  return Response.json(
    { id, token: sign(id, secret, now, "app"), expiresIn: APP_SESSION_SECONDS },
    { headers: NO_STORE },
  );
}

/* the app's request as query parameters, for Steam's return address */
const appParams = (a: AppRequest) => ({
  redirect_uri: a.redirect,
  app_state: a.state,
  code_challenge: a.challenge,
});

/* whether another site sent this request, by what the browser says of where it came from */
export function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  return (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (!!origin && origin !== new URL(request.url).origin)
  );
}

/* the Steam ID a request's browser session was signed for, or null */
export function sessionOf(request: Request, env: AuthEnv = {}): string | null {
  return sessionOfCookie(cookieOf(request, SESSION_COOKIE), env);
}

/* the Steam ID behind a request to the Prefab API, or null: the game's or an app's token when
   it sends `Authorization: Bearer` (a browser never adds that header by itself, so another
   site can't borrow it, and a bad one isn't rescued by a cookie), else the browser's cookie.
   The admin's routes ask sessionOf instead, so neither token ever takes anything down */
export function prefabSessionOf(request: Request, env: AuthEnv = {}): string | null {
  /* only a Bearer is the game's: any other Authorization (a password-protected preview's
     Basic) leaves the browser's cookie to say who it is */
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return sessionOf(request, env);
  const { secret, now } = envOf(env);
  const token = /^Bearer (\S+)$/.exec(bearer)?.[1] ?? null;
  return verify(token, secret, now, "game") ?? verify(token, secret, now, "app");
}

/* the Steam ID a session cookie's value was signed for, or null: for the one page that reads
   the session while it draws, the link page, which is never cached (ADR 0014) */
export function sessionOfCookie(value: string | null | undefined, env: AuthEnv = {}) {
  const { secret, now } = envOf(env);
  return verify(value ?? null, secret, now, "browser");
}

/* GET /api/me: { id } or { id: null }, never cached. A session that doesn't verify under a
   configured secret is cleared, so the browser stops asking; with no secret configured it
   is kept, so a deploy missing the variable signs nobody out for good */
export function whoIs(request: Request, env: AuthEnv = {}): Response {
  const { secret, now } = envOf(env);
  const token = cookieOf(request, SESSION_COOKIE);
  const id = verify(token, secret, now, "browser");
  const headers = new Headers(NO_STORE);
  if (token && !id && usable(secret))
    for (const c of sessionCookies(null)) headers.append("set-cookie", c);
  return Response.json({ id }, { headers });
}

const usable = (secret: string | undefined): secret is string => !!secret?.trim();
const mac = (body: string, secret: string) =>
  createHmac("sha256", secret.trim()).update(body).digest("base64url");

/* the session cookie's value for `id`, or the game's or an app's token with its kind signed
   in; null with no secret configured */
function sign(
  id: string,
  secret: string | undefined,
  now: number,
  kind: SessionKind = "browser",
): string | null {
  if (!usable(secret) || !isSteamId(id)) return null;
  const body = `${id}.${Math.floor(now / 1000)}${kind === "browser" ? "" : "." + kind}`;
  return `${body}.${mac(body, secret)}`;
}

/* the Steam ID a session of `kind` was signed for, or null when it is missing, altered, the
   other kind, expired, from the future, or there is no secret to check it against */
function verify(
  token: string | null,
  secret: string | undefined,
  now: number,
  kind: SessionKind,
): string | null {
  if (!token || !usable(secret)) return null;
  const parts = token.split(".");
  const sig = parts.pop();
  /* id.issued for a browser, id.issued.game for the game, id.issued.app for an app: never one
     passed as another */
  const shaped = kind === "browser" ? parts.length === 2 : parts.length === 3 && parts[2] === kind;
  if (!shaped) return null;
  const [id, issued] = parts;
  if (!isSteamId(id) || !/^\d{1,12}$/.test(issued) || !sig) return null;
  const want = Buffer.from(mac(parts.join("."), secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const age = now / 1000 - Number(issued);
  return age >= -60 && age < LIFE[kind] ? id : null;
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
