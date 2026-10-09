// Sign in with Steam over OpenID 2.0 (ADR 0008). The reader goes to Steam's login with a
// return address here carrying a random state, also kept in a cookie on their browser;
// Steam sends them back with a signed assertion, which is checked by handing it back to
// Steam (check_authentication) rather than with any key of ours. The one thing taken from
// it is the Steam ID in the claimed identity.
import { isSteamId } from "./rules";

export const STEAM_LOGIN = "https://steamcommunity.com/openid/login";
export const RETURN_PATH = "/api/auth/steam/return";
const NS = "http://specs.openid.net/auth/2.0";
const SELECT = NS + "/identifier_select";
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
/* what Steam's signature has to cover for the checks below to mean anything */
const MUST_SIGN = ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"];
/* how old an assertion may be: long enough for a slow redirect, short enough that a
   leaked return address is soon useless */
const NONCE_MS = 5 * 60_000;

/* where to come back to: a path on this site, or the home page for anything else (another
   host, a protocol-relative //host, a backslash browsers read as a slash) */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])/.test(next) && !/[\s\\]/.test(next) ? next : "/";
}

/* Steam's login page, coming back to `next` on the site at `origin` with `state` */
export function loginUrl(origin: string, next: string, state: string): string {
  const back = new URL(RETURN_PATH, origin);
  back.searchParams.set("next", safeNext(next));
  back.searchParams.set("state", state);
  const q = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": back.toString(),
    "openid.realm": origin + "/",
    "openid.identity": SELECT,
    "openid.claimed_id": SELECT,
  });
  return `${STEAM_LOGIN}?${q}`;
}

/* the Steam ID the return address `url` proves for the browser holding `state`, or null:
   a cancelled login, a repeated field, an assertion for another site, endpoint or browser,
   an old one, a claimed ID that isn't a Steam ID, or one Steam doesn't confirm (or can't be
   asked about) */
export async function verifyReturn(
  url: URL,
  state: string | null,
  check: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  const p = url.searchParams;
  /* every check reads a field's one value, and Steam is asked about that same value */
  for (const k of new Set(p.keys())) if (p.getAll(k).length !== 1) return null;
  if (
    p.get("openid.ns") !== NS ||
    p.get("openid.mode") !== "id_res" ||
    p.get("openid.op_endpoint") !== STEAM_LOGIN
  )
    return null;
  const signed = new Set((p.get("openid.signed") ?? "").split(","));
  if (!MUST_SIGN.every((f) => signed.has(f))) return null;
  const back = URL.parse(p.get("openid.return_to") ?? "");
  if (back?.origin !== url.origin || back.pathname !== RETURN_PATH) return null;
  if (!state || back.searchParams.get("state") !== state || p.get("state") !== state) return null;
  const at = Date.parse(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/.exec(p.get("openid.response_nonce") ?? "")?.[0] ?? "",
  );
  if (!(now - at < NONCE_MS && at - now < 60_000)) return null;
  const id = CLAIMED.exec(p.get("openid.claimed_id") ?? "")?.[1];
  if (!isSteamId(id) || p.get("openid.identity") !== p.get("openid.claimed_id")) return null;
  const body = new URLSearchParams();
  for (const [k, v] of p) if (k.startsWith("openid.")) body.set(k, v);
  body.set("openid.mode", "check_authentication");
  try {
    const r = await check(STEAM_LOGIN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    return /^is_valid:true$/m.test(await r.text()) ? id : null;
  } catch {
    return null;
  }
}
