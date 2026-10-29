// GET /api/search?q=: the site search in the header (components/search/). Everything the query
// finds, scored and grouped by lib/search.ts: the players read fresh, as every search is, and
// the rest found in the cached lists the pages already read (Map cards, Campaigns, the Circuit
// boards, the Dailies, the Prefabs). An empty query answers null.
import {
  getCampaigns,
  getDailies,
  getMapCards,
  getPrefabCards,
  getSite,
  searchPlayers,
  withTimes,
} from "../../../db/data";
import { campaignSummary } from "../../../lib/campaigns";
import { makersOf, searchAll, searchedMakers, searchTerm } from "../../../lib/search";

/* The CDN keeps each query's answer a minute, so a word typed letter by letter, or searched by
   many at once, reads the database once, and serves it stale five minutes more while it reads
   it again: a Map, a player or a Prefab new since then shows within a few minutes. The browser
   keeps it a minute too, for the reader who deletes back over what they typed. */
const SEARCH_CACHE = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

export async function GET(request: Request) {
  const q = searchTerm(new URL(request.url).searchParams.get("q"));
  if (!q) return Response.json(null, { headers: { "Cache-Control": SEARCH_CACHE } });
  /* which matching makers play is asked as soon as the cards are in, beside the player search */
  const made = getMapCards().then((cards) => ({ cards, makers: makersOf(cards) }));
  const [players, { cards, makers }, playing, campaigns, site, dailies, prefabs] =
    await Promise.all([
      searchPlayers(q, ""),
      made,
      made.then(({ makers }) => withTimes(searchedMakers(q, makers))),
      getCampaigns(),
      getSite(),
      getDailies(),
      getPrefabCards(),
    ]);
  return Response.json(
    searchAll(
      q,
      {
        players,
        playing: new Set(playing),
        cards,
        campaigns: campaigns.map(campaignSummary),
        boards: site.boards,
        dailies,
        prefabs,
      },
      makers,
    ),
    { headers: { "Cache-Control": SEARCH_CACHE } },
  );
}
