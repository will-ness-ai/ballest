// GET /api/board/<name>?from=&count=&q=: a slice of a board in rank order, for the list
// that grows as the reader scrolls (components/board/BoardBody). With q, only the rows
// whose persona or Steam ID contains it, each keeping its real rank and interval. A
// Circuit board or a listed Map's; anything else is a 404.
//
// GET /api/board/<name>?player=<steam id>: that player's { rank, score } on the board, or
// null when they hold no Entry on it (or nobody raced under the ID), for You's banner
// (hooks/you.ts). Something that isn't a Steam ID is a 400.
//
// GET /api/board/<name>?run=<steam id>: that run's Ghost against its rival's (RunRace in
// lib/rows.ts), or null when it has no profile, for the race drawer (components/board/
// RaceDrawer). A Daily's board is accepted too. Something that isn't a Steam ID is a 400.
import {
  getBoardPlaces,
  getBoardRun,
  isBoard,
  isRaceBoard,
  readBoard,
  searchBoard,
} from "../../../../db/data";
import { isSteamId } from "../../../../lib/rules";

/* a search pages its matches; a link to a player's row reads down to it in one go, as far
   as the largest board goes */
const MAX_SEARCH = 200,
  MAX_READ = 20_000;

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const url = new URL(request.url);
  const run = url.searchParams.get("run");
  if (run != null) {
    if (!(await isRaceBoard(name)))
      return Response.json({ error: "no such board" }, { status: 404 });
    if (!isSteamId(run)) return Response.json({ error: "not a Steam ID" }, { status: 400 });
    return Response.json(await getBoardRun(name, run));
  }
  if (!(await isBoard(name))) return Response.json({ error: "no such board" }, { status: 404 });
  const player = url.searchParams.get("player");
  if (player != null) {
    if (!isSteamId(player)) return Response.json({ error: "not a Steam ID" }, { status: 400 });
    return Response.json((await getBoardPlaces(name, [player]))[player] ?? null);
  }
  const from = Math.max(0, Math.floor(Number(url.searchParams.get("from")) || 0));
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  const count = Math.min(
    q ? MAX_SEARCH : MAX_READ,
    Math.max(1, Math.floor(Number(url.searchParams.get("count")) || 50)),
  );
  return Response.json(
    q ? await searchBoard(name, q, from, count) : await readBoard(name, from, count),
  );
}
