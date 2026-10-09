// GET /api/me: the signed-in player's Steam ID, or null (ADR 0008). Pages stay cached and
// ask this from the browser; it is never cached. A session that no longer verifies is
// cleared, so the browser stops asking.
import { connection } from "next/server";

import { sessionCookies, sessionOf } from "../../../lib/session";

export async function GET(request: Request) {
  await connection();
  const { id, stale } = sessionOf(request);
  const headers = new Headers({ "cache-control": "private, no-store" });
  if (stale) for (const c of sessionCookies(null)) headers.append("set-cookie", c);
  return Response.json({ id }, { headers });
}
