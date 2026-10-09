// POST /api/auth/signout?next=<path>: signs the reader out and returns them to `next`.
// Only from this site's own pages: another site can't post a reader out.
import { redirectTo, sessionCookies } from "../../../../lib/session";

export function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== url.origin))
    return Response.json({ error: "cross-site" }, { status: 403 });
  return redirectTo(url.searchParams.get("next"), sessionCookies(null));
}
