// GET /api/standings?since=: the Workshop standings (WorkshopStandings in lib/rows.ts), now and
// at a baseline, with each player's count and shared place on both sides (docs/adr/0009).
// Multiballs draws the Daily Report's image from them.
//
// GET /api/standings?ladders&player=<steam id>: /you's four cards for that player (YouLadders
// in lib/ladder.ts): each list's top 3 and the players around them, with the line under the
// card. Without a player, the top 3 alone. Something that isn't a Steam ID is a 400.
//
// GET /api/standings?list=<played|author|wr|top5>&from=&count=: a slice of one list in
// listing order, for "Show all" on /you. A list that isn't one is a 400.
//
// `since` is an ISO time or Unix ms, read down to the hour; without it, the /you baseline (24
// hours before the most recent 16:00 UTC). A baseline that can't be read, is in the future, or
// is more than a week back is a 400, so only a few baselines are ever cached.
import { getWorkshopStandings } from "../../../db/data";
import { isStandingsStat, laddersOf, sliceOf } from "../../../lib/ladder";
import { isSteamId } from "../../../lib/rules";
import { youBaseline } from "../../../lib/workshop-standings";

const HOUR_MS = 3_600_000;
const OLDEST_MS = 7 * 24 * HOUR_MS;
/* a slice reads down to You's row in one go, as far as any list could go */
const MAX_SLICE = 20_000;

const refuse = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(request: Request) {
  const now = Date.now();
  const params = new URL(request.url).searchParams;
  const given = params.get("since");
  const at =
    given == null ? youBaseline(now) : /^\d+$/.test(given) ? Number(given) : Date.parse(given);
  if (!Number.isFinite(at)) return refuse("since is not a time");
  const since = Math.floor(at / HOUR_MS) * HOUR_MS;
  if (since > now || since < now - OLDEST_MS) return refuse("since must be within the last week");

  if (params.has("ladders")) {
    const player = params.get("player");
    if (player != null && !isSteamId(player)) return refuse("not a Steam ID");
    return Response.json(laddersOf(await getWorkshopStandings(since), player));
  }
  const list = params.get("list");
  if (list != null) {
    if (!isStandingsStat(list)) return refuse("no such list");
    const from = Math.max(0, Math.floor(Number(params.get("from")) || 0));
    const count = Math.min(MAX_SLICE, Math.max(1, Math.floor(Number(params.get("count")) || 50)));
    return Response.json(sliceOf(await getWorkshopStandings(since), list, from, count));
  }
  return Response.json(await getWorkshopStandings(since));
}
