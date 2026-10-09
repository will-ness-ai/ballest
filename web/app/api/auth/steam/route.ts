// GET /api/auth/steam?next=<path>: off to Steam's login page (ADR 0008), to come back to
// `next` signed in. The state it sets is what the return route checks Steam's answer
// against, so only this browser can finish this sign-in.
import { connection } from "next/server";

import { newState, stateCookie } from "../../../../lib/session";
import { loginUrl } from "../../../../lib/steam-openid";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const state = newState();
  const to = loginUrl(url.origin, url.searchParams.get("next") ?? "/", state);
  return new Response(null, {
    status: 302,
    headers: { location: to, "set-cookie": stateCookie(state) },
  });
}
