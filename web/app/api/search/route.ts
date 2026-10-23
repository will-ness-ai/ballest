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
import { searchAll, searchedMakers, searchTerm } from "../../../lib/search";

/* An answer changes only when a Refresh lands (every three hours) or a Map, a Daily or a
   Prefab is added between them, so the CDN keeps each query's for ten minutes and serves it
   stale for a Refresh's length while it reads it again: a word typed letter by letter, or
   searched by many, reads the database once. The browser keeps it a minute, for the reader
   who deletes back over what they typed. */
const SEARCH_CACHE = "public, max-age=60, s-maxage=600, stale-while-revalidate=10800";

export async function GET(request: Request) {
  const q = searchTerm(new URL(request.url).searchParams.get("q"));
  if (!q) return Response.json(null, { headers: { "Cache-Control": SEARCH_CACHE } });
  const [players, cards, campaigns, site, dailies, prefabs] = await Promise.all([
    searchPlayers(q, ""),
    getMapCards(),
    getCampaigns(),
    getSite(),
    getDailies(),
    getPrefabCards(),
  ]);
  const playing = await withTimes(searchedMakers(q, cards));
  return Response.json(
    searchAll(q, {
      players,
      playing,
      cards,
      campaigns: campaigns.map(campaignSummary),
      boards: site.boards,
      dailies,
      prefabs,
    }),
    { headers: { "Cache-Control": SEARCH_CACHE } },
  );
}
