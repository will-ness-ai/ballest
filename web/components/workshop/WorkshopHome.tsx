"use client";
// The Workshop homepage's body: the search box in the head, then either Trending this
// week, the Campaigns (drawn on the server and passed in) and the shelves, or, while
// there is a search, the Maps that match it, read from /api/maps. The server picked the
// chart's Maps and each shelf's; what reads the clock (the ages, New this week) is
// counted here, so a cached page never freezes it.
import Link from "next/link";
import { useState } from "react";

import { MapCardLink, MapGrid, PodLine } from "./Card";
import { MapImage } from "../MapImage";
import { useClock, useDebouncedFetch } from "../../hooks/client";
import { mapHref, mapsHref } from "../../lib/routes";
import { fmtN, plural } from "../../lib/rules";
import { MAPS_CHUNK, SHELVES, SORTS, onShelf, type MapCard } from "../../lib/workshop";

export interface MapSearch {
  /* how many Maps match, of which `maps` is the first MAPS_CHUNK by runs */
  total: number;
  maps: Array<MapCard>;
}

/* Trending this week (spec #348): the top ten, ranks running down two columns on a desktop */
function Trending({ maps }: { maps: ReadonlyArray<MapCard> }) {
  if (!maps.length) return null;
  return (
    <section className="trend" aria-labelledby="trend-h">
      <div className="shelf-h">
        <h2 id="trend-h">Trending this week</h2>
        <span className="shelf-n">by Workshop plays in the last 7 days and votes</span>
      </div>
      <ol>
        {maps.map((m, i) => (
          <li key={m.pfid}>
            <Link href={mapHref(m.pfid)}>
              <span className="tr-n">{i + 1}</span>
              <MapImage preview={m.preview} className="tr-pic" />
              <span className="tr-in">
                <b>{m.title}</b>
                <span className="tr-by">by {m.creator}</span>
                <PodLine p={m.top3[0]} i={0} />
              </span>
              <span className="tr-fig">
                {fmtN(m.weekPlays)}
                <small>{m.weekPlays === 1 ? "play" : "plays"}</small>
                <small>
                  👍 {fmtN(m.votesUp)} · 👎 {fmtN(m.votesDown)}
                </small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Shelves({
  shelves,
  now,
}: {
  shelves: ReadonlyArray<ReadonlyArray<MapCard>>;
  now: number;
}) {
  return SHELVES.map((d, i) => {
    const list = onShelf(shelves[i] ?? [], d, now);
    if (!list.length) return null;
    return (
      <section className="shelf" key={d.title}>
        <div className="shelf-h">
          <h2>{d.title}</h2>
          <span className="shelf-n">
            {d.note} &middot; <Link href={mapsHref(d.all)}>See all</Link>
          </span>
        </div>
        <div className="strip">
          {list.map((m) => (
            <MapCardLink key={m.pfid} m={m} stat={SORTS[d.sort].stat(m, now)} />
          ))}
        </div>
      </section>
    );
  });
}

const runsStat = (m: MapCard) => SORTS.runs.stat(m, 0);

const searchMaps = async (q: string) => {
  const r = await fetch("/api/maps?" + new URLSearchParams({ q }).toString());
  if (!r.ok) throw new Error("maps -> " + String(r.status));
  return (await r.json()) as MapSearch;
};

function Results({ q, found, clear }: { q: string; found: MapSearch; clear: () => void }) {
  return (
    <>
      <div className="res-h">
        <span>
          {plural(found.total, "map", "maps")} match &ldquo;{q}&rdquo;
        </span>
        <button type="button" className="linkbtn" onClick={clear}>
          Clear
        </button>
      </div>
      {found.total ? (
        <MapGrid maps={found.maps} stat={runsStat} />
      ) : (
        <div className="empty">
          <b>No map or creator by that name.</b>
        </div>
      )}
      {found.total > MAPS_CHUNK && (
        <p className="ws-note">Showing the {MAPS_CHUNK} with the most runs.</p>
      )}
    </>
  );
}

export function WorkshopHome({
  trend,
  campaigns,
  shelves,
  asOf,
}: {
  /* Trending this week's Maps, in order */
  trend: ReadonlyArray<MapCard>;
  /* the Campaigns' carousel, under the chart */
  campaigns: React.ReactNode;
  /* each of SHELVES' Maps, in order */
  shelves: ReadonlyArray<ReadonlyArray<MapCard>>;
  asOf: number;
}) {
  const now = useClock(asOf);
  const [query, setQuery] = useState("");
  const q = query.trim();
  /* as the single-page site did, the body changes once a search has its answer: until
     then the last answer, or the carousel and shelves */
  const found = useDebouncedFetch(q, searchMaps).last;
  const shown = q ? found : null;
  return (
    <>
      <div className="ws-head">
        <h1 className="ws-h1">Workshop</h1>
        <span className="ws-tools">
          <Link className="alllink" href={mapsHref()}>
            All maps &rarr;
          </Link>
          <input
            className="ws-q"
            id="wsq"
            type="search"
            placeholder="Search maps"
            aria-label="Search maps by title or creator"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </span>
      </div>
      <div id="wsbody">
        {shown ? (
          <Results
            q={shown.key}
            found={shown.data}
            clear={() => {
              setQuery("");
            }}
          />
        ) : (
          <>
            <Trending maps={trend} />
            {campaigns}
            <Shelves shelves={shelves} now={now} />
          </>
        )}
      </div>
    </>
  );
}
