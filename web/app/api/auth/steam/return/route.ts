// GET /api/auth/steam/return: where Steam sends the reader back. A login Steam confirms
// signs them in; anything else (cancelled, forged, Steam unreachable, no SESSION_SECRET)
// leaves them as they were. Either way they land on the page they left.
import { connection } from "next/server";

import { sessionCookies, sign } from "../../../../../lib/session";
import { safeNext, verifyReturn } from "../../../../../lib/steam-openid";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const id = await verifyReturn(url);
  const token = id && sign(id, process.env.SESSION_SECRET);
  const headers = new Headers({ location: safeNext(url.searchParams.get("next")) });
  if (token) for (const c of sessionCookies(token)) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}
