// Every page's frame: the header with the brand, when the boards were read and You's card,
// the tabs, the page itself, and the footer. `view` is the .app's data-view, which the stylesheet
// keys each view's layout off.
import Link from "next/link";
import { Suspense } from "react";

import { Freshness } from "./Freshness";
import { GroupTabs, Tabs, type GroupTab } from "./GroupTabs";
import { Rack } from "./Marble";
import { YouCard } from "./YouCard";
import { ProtoNav, type NavData } from "./prototype/Nav";
import { getCampaigns, getDailies, getDailyDates, getSite, hasWorkshop } from "../db/data";
import { seasonsOf } from "../lib/player";
import {
  CIRCUIT_TAB,
  DAILY_TAB,
  PLAYERS_TAB,
  PREFABS_TAB,
  WORKSHOP_GROUP,
  boardHref,
  campaignHref,
  campaignsHref,
  dailyHref,
  homeHref,
  playersHref,
  prefabsHref,
} from "../lib/routes";
import { SITE_TITLE } from "../lib/rules";

export type View =
  | "board"
  | "map"
  | "workshop"
  | "maps"
  | "player"
  | "vs"
  | "players"
  | "daily"
  | "prefab"
  | "prefabs"
  | "you";

/* the Workshop is the homepage, so its tab leads and the Daily, a Map a day, follows it;
   the Circuit opens on its newest season's Overall board, and Players, over every board,
   comes next, then the Prefabs for the level editor */
async function tabs(): Promise<Array<GroupTab>> {
  const [site, workshop, dailies] = await Promise.all([getSite(), hasWorkshop(), getDailyDates()]);
  const newest = seasonsOf(site.boards).at(0);
  return [
    ...(workshop ? [{ group: WORKSHOP_GROUP, href: homeHref() }] : []),
    ...(dailies.length ? [{ group: DAILY_TAB, href: dailyHref() }] : []),
    ...(newest ? [{ group: CIRCUIT_TAB, href: boardHref(newest.overall) }] : []),
    { group: PLAYERS_TAB, href: playersHref("all", "wr") },
    { group: PREFABS_TAB, href: prefabsHref() },
  ];
}

/* PROTOTYPE (claude/prototype-nav): what every variant's navigation needs */
async function navData(): Promise<NavData> {
  const [site, workshop, dailies, campaigns] = await Promise.all([
    getSite(),
    hasWorkshop(),
    getDailies().catch(() => []),
    getCampaigns(),
  ]);
  const seasons = seasonsOf(site.boards);
  const last = dailies.at(-1);
  return {
    workshop: workshop ? homeHref() : null,
    daily: dailies.length ? dailyHref() : null,
    circuit: seasons.at(0) ? boardHref(seasons[0].overall) : null,
    players: playersHref("all", "wr"),
    prefabs: prefabsHref(),
    campaigns: campaignsHref(),
    seasons: seasons.map((s) => ({
      label: s.group,
      href: boardHref(s.overall),
      players: s.players,
    })),
    today: last
      ? { title: last.title, preview: last.preview, players: last.entryCount, href: dailyHref() }
      : null,
    topCampaigns: campaigns.slice(0, 4).map((c) => ({
      title: c.c.title,
      preview: c.previews.find(Boolean) ?? null,
      players: c.players,
      href: campaignHref(c.c.slug),
    })),
  };
}

export async function Shell({ view, children }: { view: View; children: React.ReactNode }) {
  const [site, list, nav] = await Promise.all([getSite(), tabs(), navData()]);
  const fresh = <Freshness refreshedAt={site.refreshedAt} mapsReadBy={site.mapsReadBy} />;
  return (
    <div className="app" id="app" data-view={view}>
      <ProtoNav
        d={nav}
        you={<YouCard />}
        fresh={fresh}
        original={
          <>
            <header className="hdr">
              <Link className="brand" href={homeHref()}>
                <Rack />
                <span className="wordmark">{SITE_TITLE}</span>
              </Link>
              <p className="tagline">Circuit and Workshop leaderboards</p>
              {fresh}
              <YouCard />
            </header>

            <Suspense fallback={<Tabs tabs={list} on={null} />}>
              <GroupTabs tabs={list} />
            </Suspense>
          </>
        }
      />

      {children}

      <footer>
        <p>
          Read straight from the Steam leaderboards for app 3339810, refreshed every few hours. A
          fan project, not affiliated with the developer.
        </p>
        <p>
          A top run shows the ball it was rolled with, read from its ghost. Any other marble takes
          its colour from the player&apos;s Steam ID.
        </p>
        <p>
          Signing in with Steam keeps only your Steam ID, in a signed cookie on this browser, to
          show where you stand. Sign out from your own page.
        </p>
      </footer>
    </div>
  );
}
