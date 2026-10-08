// POST /api/auth/signout?next=<path>: signs the reader out and returns them to `next`.
import { sessionCookies } from "../../../../lib/session";
import { safeNext } from "../../../../lib/steam-openid";

export function POST(request: Request) {
  const headers = new Headers({
    location: safeNext(new URL(request.url).searchParams.get("next")),
  });
  for (const c of sessionCookies(null)) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}
