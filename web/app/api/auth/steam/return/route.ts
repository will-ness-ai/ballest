// GET /api/auth/steam/return: where Steam sends the reader back. A login Steam confirms,
// for the browser that started it, signs them in; anything else (cancelled, forged,
// replayed, Steam unreachable, no SESSION_SECRET) leaves them as they were. Either way the
// state is spent and they land on the page they left.
import { connection } from "next/server";

import { STATE_COOKIE } from "../../../../../lib/cookies";
import {
  cookieOf,
  redirectTo,
  sessionCookies,
  sign,
  stateCookie,
} from "../../../../../lib/session";
import { verifyReturn } from "../../../../../lib/steam-openid";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const id = await verifyReturn(url, cookieOf(request, STATE_COOKIE));
  const token = id && sign(id, process.env.SESSION_SECRET);
  const cookies = [stateCookie(null), ...(token ? sessionCookies(token) : [])];
  return redirectTo(url.searchParams.get("next"), cookies);
}
