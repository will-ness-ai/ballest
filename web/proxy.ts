import { NextResponse, type NextRequest } from "next/server";

// /leth has to become /leth/, as Pages redirected a folder, because its page loads
// data/ relatively. A redirect in next.config.ts cannot do it: its sources match
// with or without the slash, so /leth/ would redirect to itself.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== "/leth") return NextResponse.next();
  // a plain URL: a NextURL drops the trailing slash again when it is serialized
  return NextResponse.redirect(new URL("/leth/" + request.nextUrl.search, request.url), 301);
}

export const config = { matcher: "/leth" };
