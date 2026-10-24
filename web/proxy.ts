import { NextResponse, type NextRequest } from "next/server";

import { circuitBoard } from "./lib/circuit";
import { plValid } from "./lib/players";
import {
  DAILY_DATE,
  DAILY_STANDINGS,
  MAP_FILE,
  PLAYER_TABS,
  campaignPath,
  isDailyDate,
  PODIUM_SORT,
  PREFAB_SLUG,
  isPlScope,
  isPlSort,
  playerHref,
  playersHref,
  isGeneratorKey,
  makePrefabHref,
} from "./lib/routes";
import { PFID, STEAM_ID } from "./lib/rules";
import { isPreset } from "./lib/workshop";

// The checks that have to happen before a response starts:
// - /leth has to become /leth/, as Pages redirected a folder, because its page loads
//   data/ relatively. A redirect in next.config.ts cannot do it: its sources match with or
//   without the slash, so /leth/ would redirect to itself.
// - A board name that isn't one, or a board path with anything after it but a Steam ID or
//   (Overall) podiums, gets a real 404. Every page streams its static shell
//   first, so a notFound() in the page itself could only answer 200 (a soft 404); the
//   Circuit's boards are a fixed list, so this can tell before anything is sent.
// - So is a Campaign path whose slug isn't a curated Campaign, or with anything after it
//   but one of its Maps, a Steam ID, podiums, or an Event's id and a Steam ID
//   (lib/campaigns.ts is a fixed list too). A curated Campaign none of whose Maps the
//   Workshop lists, or one of its Maps it no longer lists, is only known to the page, which
//   can only be a soft 404.
// - So are the Players table's scopes and sorts: one that isn't is a 404, and a scope on
//   its own, or the Circuit by Maps (it has no Maps column), goes to the scope's table.
// - So are All maps' views, and a Map's path has a fixed shape: its page, a player's row
//   on it, or its file (a Map that has left the Workshop is only known to the page, which
//   sends the reader home).
// - A Daily's path is /daily, /daily/<a real day> or /daily/standings; a well-formed day
//   with no Daily is only known to the page, which sends the reader to /daily.
// - A Prefab's path is /prefab/<a slug>; a slug nobody uploaded is only known to the page,
//   which says the Prefab is gone.
// - A Generator's path is /prefabs/make/<one of GENERATOR_KEYS>; /prefabs/collage, the
//   Generators' review page, is not in production.
// - A player's or a head to head's path that isn't shaped like one (no Steam ID, an
//   unknown tab) is the same; one with a Steam ID nobody raced under can only be a soft
//   404. A head to head of a player against themselves is just their page.
const ID = STEAM_ID.source;
const PLAYER_PATH = new RegExp(`^/player/${ID}(?:/(?:${PLAYER_TABS.join("|")}))?$`);
const VS_PATH = new RegExp(`^/vs/(${ID})/(${ID})$`);
const MAP_PATH = new RegExp(`^/map/${PFID.source}(/(?:${ID}|${MAP_FILE}))?$`);
/* a board's name is letters, digits and _, so it never needs decoding */
const DAILY_PATH = new RegExp(`^/daily(?:/(${DAILY_DATE.source}|${DAILY_STANDINGS}))?/?$`);
const PREFAB_PATH = new RegExp(`^/prefab/${PREFAB_SLUG.source}$`);
const BOARD_PATH = new RegExp(`^/board/(\\w{1,64})(?:/(?:${ID}|${PODIUM_SORT}))?/?$`);

const notFound = (request: NextRequest) =>
  NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/leth")
    // a plain URL: a NextURL drops the trailing slash again when it is serialized
    return NextResponse.redirect(new URL("/leth/" + request.nextUrl.search, request.url), 301);
  if (path.startsWith("/board/")) {
    const board = BOARD_PATH.exec(path);
    if (!board || !circuitBoard(board[1])) return notFound(request);
  }
  if (path.startsWith("/campaign/") && !campaignPath(path)) return notFound(request);
  const pl = /^\/players\/(.+?)\/?$/.exec(path);
  if (pl) {
    const slot = pl[1].split("/"),
      [scope] = slot,
      sort = slot.at(1);
    if (slot.length > 2 || !isPlScope(scope) || (sort !== undefined && !isPlSort(sort)))
      return notFound(request);
    if (!sort || !plValid(scope, sort))
      return NextResponse.redirect(new URL(playersHref(scope, "wr"), request.url));
  }
  const maps = /^\/maps\/(.*)$/.exec(path);
  if ((maps?.[1] && !isPreset(maps[1])) || (path.startsWith("/map/") && !MAP_PATH.test(path)))
    return notFound(request);
  if (path.startsWith("/daily/")) {
    const day = DAILY_PATH.exec(path);
    if (!day || (day[1] && day[1] !== DAILY_STANDINGS && !isDailyDate(day[1])))
      return notFound(request);
  }
  if (path.startsWith("/prefab/") && (path.length > 72 || !PREFAB_PATH.test(path)))
    return notFound(request);
  /* the Generators' collage is for agents on previews and dev servers, not players */
  if (path === "/prefabs/collage" && process.env.VERCEL_ENV === "production")
    return notFound(request);
  /* the QR code was a Generator until 2026-10-24: its old links land on Make your own */
  if (path === "/prefabs/make/qr")
    return NextResponse.redirect(new URL(makePrefabHref(), request.url), 308);
  const make = /^\/prefabs\/make\/(.*)$/.exec(path);
  if (make && !isGeneratorKey(make[1])) return notFound(request);
  const vs = VS_PATH.exec(path);
  if (vs && vs[1] === vs[2]) return NextResponse.redirect(new URL(playerHref(vs[1]), request.url));
  if ((path.startsWith("/player/") && !PLAYER_PATH.test(path)) || (path.startsWith("/vs/") && !vs))
    return notFound(request);
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/leth",
    "/board/:path*",
    "/campaign/:path*",
    "/players/:path*",
    "/maps/:path*",
    "/map/:path*",
    "/player/:path*",
    "/vs/:path*",
    "/daily/:path*",
    "/prefab/:path*",
    "/prefabs/make/:path*",
    "/prefabs/collage",
  ],
};
