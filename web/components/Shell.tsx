// Every page's frame: the header (the bar with the brand and You's card, when the boards were
// read, the Sections and the current Section's sub-tabs), the page itself, and the footer.
// `view` is the .app's data-view, which the stylesheet keys each view's layout off.
import Link from "next/link";
import { Suspense } from "react";

import { Freshness } from "./Freshness";
import { Rack } from "./Marble";
import { SectionNav, SectionRows } from "./SectionNav";
import { YouCard } from "./YouCard";
import { frameOf } from "./frame";
import { SearchBar } from "./search/SearchBar";
import { navOf } from "../lib/nav";
import { homeHref } from "../lib/routes";
import { SITE_TITLE, SITE_WORDMARK } from "../lib/rules";

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

export async function Shell({ view, children }: { view: View; children: React.ReactNode }) {
  const { site, facts, jumps } = await frameOf();
  return (
    <div className="app" id="app" data-view={view}>
      {/* the bar, then Refreshed, then the two rows of links: a grid that puts Refreshed
          under the bar on a phone and at the sub-tabs' end on a desktop. The site search sits
          between the brand and You */}
      <header className="hdr">
        <div className="bar">
          <Link className="brand" href={homeHref()}>
            <Rack />
            <span className="wordmark">
              {SITE_WORDMARK[0]}
              <em>{SITE_WORDMARK[1]}</em>
            </span>
          </Link>
          {/* You's card goes in with it, so a phone keeps the search button beside it */}
          <SearchBar jumps={jumps} you={<YouCard />} />
        </div>
        <Freshness refreshedAt={site.refreshedAt} mapsReadBy={site.mapsReadBy} />
        <Suspense fallback={<SectionRows nav={navOf("", facts)} />}>
          <SectionNav facts={facts} />
        </Suspense>
      </header>

      {children}

      <footer>
        <p>
          {SITE_TITLE} is read straight from the Steam leaderboards for Ballest of Them All (app
          3339810), refreshed every few hours. A fan project, not affiliated with the developer.
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
