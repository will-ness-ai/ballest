// What /sitemap.xml lists (app/sitemap.ts): the pages that stand on their own and are
// worth a search result, not every one robots.txt allows. Each listed page is a server
// render once per Refresh for whichever crawler reads it, so the list stays in the low
// thousands: every Circuit board, every Workshop Map with a time, every Daily, and the
// players with a world record or podium, of some 15,000 with a page.
import { CIRCUIT } from "./circuit";
import { plPlayer } from "./players";
import {
  SITE_ORIGIN,
  boardHref,
  dailyHref,
  dailyStandingsHref,
  homeHref,
  mapHref,
  mapsHref,
  playerHref,
  playersHref,
} from "./routes";
import type { DailyCell, StandingsRow } from "./rows";

export interface SitemapData {
  /* the pfid of every Map with a time */
  maps: ReadonlyArray<string>;
  dailies: ReadonlyArray<Pick<DailyCell, "date" | "endsAt" | "final">>;
  players: ReadonlyArray<StandingsRow>;
}

/* one <url> of the sitemap, as Next's MetadataRoute.Sitemap takes it */
export interface SitemapEntry {
  url: string;
  lastModified?: string;
}

/* a world record or podium on the Circuit or the Workshop */
const onPodium = (r: StandingsRow) => {
  const { c, w } = plPlayer(r);
  return c.wr + w.wr + c.pod + w.pod > 0;
};

/* Only a final Daily says when it last changed: its close. A live page changes every
   Refresh, and a lastmod that moves that often only asks crawlers back sooner. */
export function sitemapOf(d: SitemapData): Array<SitemapEntry> {
  const at = (path: string, lastModified?: string): SitemapEntry => ({
    url: SITE_ORIGIN + path,
    ...(lastModified ? { lastModified } : {}),
  });
  return [
    at(homeHref()),
    at(mapsHref()),
    at(playersHref("all", "wr")),
    at(dailyHref()),
    at(dailyStandingsHref()),
    ...CIRCUIT.map((b) => at(boardHref(b.name))),
    ...d.maps.map((pfid) => at(mapHref(pfid))),
    ...d.dailies.map((day) => at(dailyHref(day.date), day.final ? day.endsAt : undefined)),
    ...d.players.filter(onPodium).map((r) => at(playerHref(r[0]))),
  ];
}
