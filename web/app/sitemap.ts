// /sitemap.xml: the pages lib/sitemap.ts picks. It reads the cached data (db/data.ts), so
// it is prerendered and read fresh after each Refresh, like the pages it lists.
import type { MetadataRoute } from "next";

import { getDailies, getStandings, getWorkshop } from "../db/data";
import { sitemapOf } from "../lib/sitemap";
import { timed } from "../lib/workshop";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [maps, dailies, standings] = await Promise.all([
    getWorkshop(),
    getDailies(),
    getStandings(),
  ]);
  return sitemapOf({
    maps: timed(maps).map((m) => m.pfid),
    dailies,
    players: standings.players,
  });
}
