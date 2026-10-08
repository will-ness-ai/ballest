// Every page's frame: the header with the brand and when the boards were read, the tabs,
// the page itself, and the footer. `view` is the .app's data-view, which the stylesheet
// keys each view's layout off.
import Link from "next/link";
import { Suspense } from "react";

import { Freshness } from "./Freshness";
import { GroupTabs, Tabs, type GroupTab } from "./GroupTabs";
import { Rack } from "./Marble";
import { Picker, YouHeader } from "./proto/You";
import { getSite, getWorkshop } from "../db/data";
import { groupsOf, overallOf } from "../lib/player";
import { PLAYERS_TAB, WORKSHOP_GROUP, boardHref, homeHref, playersHref } from "../lib/routes";
import { SITE_TITLE } from "../lib/rules";

export type View = "board" | "map" | "workshop" | "maps" | "player" | "vs" | "players";

/* the Workshop is the homepage, so its tab leads; Players, over every board, comes last */
async function tabs(): Promise<Array<GroupTab>> {
  const [site, maps] = await Promise.all([getSite(), getWorkshop()]);
  const seasons = groupsOf(site.boards).map((group) => {
    const open = overallOf(site.boards, group) ?? site.boards.find((b) => b.group === group);
    return { group, href: open ? boardHref(open.name) : homeHref() };
  });
  return [
    ...(maps.length ? [{ group: WORKSHOP_GROUP, href: homeHref() }] : []),
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
        <YouHeader at="hdr" />
      </header>

      <div className="proto-tabs">
        <Suspense fallback={<Tabs tabs={list} on={null} />}>
          <GroupTabs tabs={list} />
        </Suspense>
        <YouHeader at="tabs" />
      </div>
      <Picker />

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
      </footer>
    </div>
  );
}
