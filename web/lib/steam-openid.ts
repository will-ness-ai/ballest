// Sign in with Steam over OpenID 2.0 (ADR 0008). The reader goes to Steam's login with a
// return address here; Steam sends them back with a signed assertion, which is checked by
// handing it back to Steam (check_authentication) rather than with any key of ours. The
// one thing taken from it is the Steam ID in the claimed identity.
import { isSteamId } from "./rules";

export const STEAM_LOGIN = "https://steamcommunity.com/openid/login";
export const RETURN_PATH = "/api/auth/steam/return";
const NS = "http://specs.openid.net/auth/2.0";
const SELECT = NS + "/identifier_select";
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

/* where to come back to: a path on this site, or the home page for anything else (another
   host, a protocol-relative //host, a backslash browsers read as a slash) */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])/.test(next) && !/[\s\\]/.test(next) ? next : "/";
}

/* Steam's login page, coming back to `next` on the site at `origin` */
export function loginUrl(origin: string, next: string): string {
  const back = new URL(RETURN_PATH, origin);
  back.searchParams.set("next", safeNext(next));
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

/* the Steam ID the return address `url` proves, or null: a cancelled login, an assertion
   for another site or another endpoint, a claimed ID that isn't a Steam ID, or one Steam
   doesn't confirm (or can't be asked about) */
export async function verifyReturn(url: URL, check: typeof fetch = fetch): Promise<string | null> {
  const p = url.searchParams;
  if (p.get("openid.mode") !== "id_res" || p.get("openid.op_endpoint") !== STEAM_LOGIN) return null;
  const back = URL.parse(p.get("openid.return_to") ?? "");
  if (back?.origin !== url.origin || back.pathname !== RETURN_PATH) return null;
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
