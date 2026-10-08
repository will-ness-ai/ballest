// GET /api/auth/steam?next=<path>: off to Steam's login page (ADR 0008), to come back to
// `next` signed in.
import { connection } from "next/server";

import { loginUrl } from "../../../../lib/steam-openid";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  return Response.redirect(loginUrl(url.origin, url.searchParams.get("next") ?? "/"), 302);
}
