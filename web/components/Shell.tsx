// Every page's frame: the header with the brand, when the boards were read and You's card, the tabs,
// the page itself, and the footer. `view` is the .app's data-view, which the stylesheet
// keys each view's layout off.
import Link from "next/link";
import { Suspense } from "react";

import { Freshness } from "./Freshness";
import { GroupTabs, Tabs, type GroupTab } from "./GroupTabs";
import { Rack } from "./Marble";
import { YouCard } from "./YouCard";
import { getDailyDates, getSite, getWorkshop } from "../db/data";
import { groupsOf, overallOf } from "../lib/player";
import {
  DAILY_TAB,
  PLAYERS_TAB,
  WORKSHOP_GROUP,
  boardHref,
  dailyHref,
  homeHref,
  playersHref,
} from "../lib/routes";
import { SITE_TITLE } from "../lib/rules";

export type View = "board" | "map" | "workshop" | "maps" | "player" | "vs" | "players" | "daily";

/* the Workshop is the homepage, so its tab leads and the Daily, a Map a day, follows it;
   Players, over every board, comes last */
async function tabs(): Promise<Array<GroupTab>> {
  const [site, maps, dailies] = await Promise.all([getSite(), getWorkshop(), getDailyDates()]);
  const seasons = groupsOf(site.boards).map((group) => {
    const open = overallOf(site.boards, group) ?? site.boards.find((b) => b.group === group);
    return { group, href: open ? boardHref(open.name) : homeHref() };
  });
  return [
    ...(maps.length ? [{ group: WORKSHOP_GROUP, href: homeHref() }] : []),
    ...(dailies.length ? [{ group: DAILY_TAB, href: dailyHref() }] : []),
    ...seasons,
    { group: PLAYERS_TAB, href: playersHref("all", "wr") },
  ];
}

export async function Shell({ view, children }: { view: View; children: React.ReactNode }) {
  const [site, list] = await Promise.all([getSite(), tabs()]);
  return (
    <div className="app" id="app" data-view={view}>
      <header className="hdr">
        <Link className="brand" href={homeHref()}>
          <Rack />
          <span className="wordmark">{SITE_TITLE}</span>
        </Link>
        <p className="tagline">Circuit and Workshop leaderboards</p>
        <Freshness refreshedAt={site.refreshedAt} mapsReadBy={site.mapsReadBy} />
        <YouCard />
      </header>

      <Suspense fallback={<Tabs tabs={list} on={null} />}>
        <GroupTabs tabs={list} />
      </Suspense>

      {children}

      <footer>
        <p>
          Read straight from the Steam leaderboards for app 3339810, refreshed every few hours. A
          fan project, not affiliated with the developer.
        </p>
        <p>
          Marble colours are derived from each player&apos;s Steam ID. The leaderboard API
          doesn&apos;t expose the ball someone actually raced with.
        </p>
        <p>
          Signing in with Steam keeps only your Steam ID, in a cookie on this browser, to show where
          you stand. Sign out from your own page.
        </p>
      </footer>
    </div>
  );
}
