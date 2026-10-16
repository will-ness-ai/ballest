// GET /api/standings?since=: the Workshop standings (WorkshopStandings in lib/rows.ts), now and
// at a baseline, with each player's count and shared place on both sides (docs/adr/0009). The
// /you page reads them, and Multiballs draws the Daily Report's image from them.
//
// `since` is an ISO time or Unix ms, read down to the hour; without it, the /you baseline (24
// hours before the most recent 16:00 UTC). A baseline that can't be read, is in the future, or
// is more than a week back is a 400, so only a few baselines are ever cached.
import { getWorkshopStandings } from "../../../db/data";
import { youBaseline } from "../../../lib/workshop-standings";

const HOUR_MS = 3_600_000;
const OLDEST_MS = 7 * 24 * HOUR_MS;

export async function GET(request: Request) {
  const now = Date.now();
  const given = new URL(request.url).searchParams.get("since");
  const at = given == null ? youBaseline(now) : /^\d+$/.test(given) ? Number(given) : Date.parse(given);
  if (!Number.isFinite(at)) return Response.json({ error: "since is not a time" }, { status: 400 });
  const since = Math.floor(at / HOUR_MS) * HOUR_MS;
  if (since > now || since < now - OLDEST_MS)
    return Response.json({ error: "since must be within the last week" }, { status: 400 });
  return Response.json(await getWorkshopStandings(since));
}
