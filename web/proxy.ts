import { NextResponse, type NextRequest } from "next/server";

import { circuitBoard } from "./lib/circuit";

// Two checks that have to happen before a response starts:
// - /leth has to become /leth/, as Pages redirected a folder, because its page loads
//   data/ relatively. A redirect in next.config.ts cannot do it: its sources match with or
//   without the slash, so /leth/ would redirect to itself.
// - A board name that isn't one gets a real 404. Every page streams its static shell
//   first, so a notFound() in the page itself could only answer 200 (a soft 404); the
//   Circuit's boards are a fixed list, so this can tell before anything is sent.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/leth")
    // a plain URL: a NextURL drops the trailing slash again when it is serialized
    return NextResponse.redirect(new URL("/leth/" + request.nextUrl.search, request.url), 301);
  const board = /^\/board\/([^/]+)/.exec(path);
  if (board && !circuitBoard(decodeURIComponent(board[1])))
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: ["/leth", "/board/:path*"] };
