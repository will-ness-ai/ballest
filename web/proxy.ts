import { NextResponse, type NextRequest } from "next/server";

import { circuitBoard } from "./lib/circuit";
import { plValid } from "./lib/players";
import { PL_SCOPES, PL_SORTS, playersHref, type PlScope, type PlSort } from "./lib/routes";

// The checks that have to happen before a response starts:
// - /leth has to become /leth/, as Pages redirected a folder, because its page loads
//   data/ relatively. A redirect in next.config.ts cannot do it: its sources match with or
//   without the slash, so /leth/ would redirect to itself.
// - A board name that isn't one gets a real 404. Every page streams its static shell
//   first, so a notFound() in the page itself could only answer 200 (a soft 404); the
//   Circuit's boards are a fixed list, so this can tell before anything is sent.
// - So are the Players table's scopes and sorts: one that isn't is a 404, and a scope on
//   its own, or the Circuit by Maps (it has no Maps column), goes to the scope's table.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/leth")
    // a plain URL: a NextURL drops the trailing slash again when it is serialized
    return NextResponse.redirect(new URL("/leth/" + request.nextUrl.search, request.url), 301);
  const board = /^\/board\/([^/]+)/.exec(path);
  if (board && !circuitBoard(decodeURIComponent(board[1])))
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  const pl = /^\/players\/(.+?)\/?$/.exec(path);
  if (pl) {
    const slot = pl[1].split("/"),
      scope = slot[0] as PlScope,
      sort = slot[1] as PlSort | undefined;
    if (
      slot.length > 2 ||
      !PL_SCOPES.includes(scope) ||
      (sort !== undefined && !PL_SORTS.includes(sort))
    )
      return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
    if (!sort || !plValid(scope, sort))
      return NextResponse.redirect(new URL(playersHref(scope, "wr"), request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/leth", "/board/:path*", "/players/:path*"] };
