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
} from "../../../db/data";
import { searchAll, searchTerm } from "../../../lib/search";

export async function GET(request: Request) {
  const q = searchTerm(new URL(request.url).searchParams.get("q"));
  if (!q) return Response.json(null);
  const [players, cards, campaigns, site, dailies, prefabs] = await Promise.all([
    searchPlayers(q, ""),
    getMapCards(),
    getCampaigns(),
    getSite(),
    getDailies(),
    getPrefabCards(),
  ]);
  return Response.json(
    searchAll(q, {
      players,
      cards,
      campaigns: campaigns.map(({ c, players, previews }) => ({
        slug: c.slug,
        title: c.title,
        creator: c.creator,
        maps: c.maps.length,
        players,
        preview: previews.find(Boolean) ?? null,
      })),
      boards: site.boards,
      dailies,
      prefabs,
    }),
  );
}
