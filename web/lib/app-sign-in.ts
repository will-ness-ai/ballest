// What a desktop app's sign-in through the browser checks (ADR 0017), apart from Steam's own
// login: the app's request (a loopback callback, its state and its PKCE challenge) and the
// one-time code the browser carries back to it. The routes are lib/auth.ts's startAppSignIn,
// finishAppSignIn and signInFromApp.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { isSteamId } from "./rules";

export const APP_START_PATH = "/api/auth/app";
export const APP_RETURN_PATH = "/api/auth/app/return";
/* long enough for the browser to reach the app and the app to trade it, short enough that a
   code seen later in a history or a log has long run out */
export const APP_CODE_SECONDS = 120;

/* what the app asked for: where to send the browser back, the state it gets back there, and
   the SHA-256 (base64url) of the secret it will trade the code with */
export interface AppRequest {
  redirect: string;
  state: string;
  challenge: string;
}

const STATE = /^[A-Za-z0-9._~-]{1,200}$/;
/* a SHA-256, base64url without padding (RFC 7636's S256) */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/* RFC 7636's code_verifier */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/* the app's request in `params`, or null for anything that doesn't check: a callback that
   isn't plain http on the loopback address (RFC 8252: 127.0.0.1 or [::1], any port and path,
   no user or fragment), a state that isn't 1-200 URL-safe characters, a challenge that isn't
   a SHA-256, a method other than S256, or any of them given twice. The state is read from
   `stateKey`: Steam's return address carries the app's as app_state, beside the site's own */
export function appRequestOf(params: URLSearchParams, stateKey = "state"): AppRequest | null {
  const one = (k: string) => (params.getAll(k).length === 1 ? params.get(k) : null);
  const method = params.getAll("code_challenge_method");
  if (method.length > 1 || (method.length === 1 && method[0] !== "S256")) return null;
  const redirect = one("redirect_uri");
  const state = one(stateKey);
  const challenge = one("code_challenge");
  if (!redirect || !isLoopback(redirect) || !state || !STATE.test(state)) return null;
  if (!challenge || !CHALLENGE.test(challenge)) return null;
  return { redirect, state, challenge };
}

function isLoopback(redirect: string): boolean {
  const u = URL.parse(redirect);
  return (
    !!u &&
    u.protocol === "http:" &&
    (u.hostname === "127.0.0.1" || u.hostname === "[::1]") &&
    !u.username &&
    !u.password &&
    !redirect.includes("#")
  );
}

/* the app's callback with `params` added to whatever query it already had */
export function callbackOf(redirect: string, params: Record<string, string>): string {
  const u = new URL(redirect);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const mac = (body: string, secret: string) =>
  createHmac("sha256", secret.trim())
    /* never the same input as a session's, so neither passes as the other */
    .update("app-code:" + body)
    .digest("base64url");

/* the code the browser carries back to the app: `id`, when, and the app's challenge, signed */
export function codeFor(id: string, challenge: string, secret: string, now: number): string {
  const body = `${id}.${Math.floor(now / 1000)}.${challenge}`;
  return `${body}.${mac(body, secret)}`;
}

/* the Steam ID a code was made for, or null when it is altered, run out, from the future, or
   `verifier` isn't the secret behind its challenge */
export function idOfCode(code: unknown, verifier: unknown, secret: string, now: number) {
  if (typeof code !== "string" || typeof verifier !== "string" || !VERIFIER.test(verifier))
    return null;
  const parts = code.split(".");
  if (parts.length !== 4) return null;
  const [id, issued, challenge, sig] = parts;
  if (!isSteamId(id) || !/^\d{1,12}$/.test(issued) || !CHALLENGE.test(challenge)) return null;
  const want = Buffer.from(mac(`${id}.${issued}.${challenge}`, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const age = now / 1000 - Number(issued);
  if (!(age >= -60 && age < APP_CODE_SECONDS)) return null;
  return createHash("sha256").update(verifier).digest("base64url") === challenge ? id : null;
}
