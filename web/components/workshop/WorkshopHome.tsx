"use client";
// The Workshop homepage's body: the search box in the head, then either the carousel of
// five picks and the shelves, or, while there is a search, the Maps that match it, read
// from /api/maps. The server picked the carousel's Maps and each shelf's; what reads the
// clock (the ages, New this week) is counted here, so a cached page never freezes it.
import Link from "next/link";
import { useState } from "react";

import { CreatorLink, MapCardLink, MapGrid, PodLine } from "./Card";
import { MapImage } from "../MapImage";
import { useClock, useDebouncedFetch } from "../../hooks/client";
import { mapHref, mapsHref } from "../../lib/routes";
import { fmtN, fmtTime, plural } from "../../lib/rules";
import {
  MAPS_CHUNK,
  SHELVES,
  SORTS,
  onShelf,
  recordOf,
  whyOf,
  type MapCard,
  type Pick,
} from "../../lib/workshop";

export interface MapSearch {
  /* how many Maps match, of which `maps` is the first MAPS_CHUNK by runs */
  total: number;
  maps: Array<MapCard>;
}

function Carousel({ picks, now }: { picks: ReadonlyArray<Pick>; now: number }) {
  const [slide, setSlide] = useState(0);
  if (!picks.length) return null;
  const step = (d: number) => {
    setSlide((s) => (s + d + picks.length) % picks.length);
  };
  const p = picks[slide],
    m = p.m;
  return (
    <div
      className="car"
      id="car"
      /* the timer is the progress line itself: when it finishes filling, move on */
      onAnimationEnd={(e) => {
        if (e.animationName === "carfill") step(1);
      }}
    >
      <div className="car-pic">
        {picks.map((x, i) => (
          <MapImage
            key={x.m.pfid}
            preview={x.m.preview}
            className={"sl" + (i === slide ? " on" : "")}
          />
        ))}
      </div>
      <div id="carInfo">
        {/* keyed by the slide, so the copy slides in (fades, with less motion) and the
            progress line restarts */}
        <div className="car-in" key={slide}>
          <span className="eyebrow">
            {p.label} <span className="why">&middot; {whyOf(p, now)}</span>
          </span>
          <h2 className="car-t">{m.title}</h2>
          <span className="car-by">
            by <CreatorLink m={m} />
          </span>
          <div className="car-stats">
            <span>
              <b>{fmtN(m.entryCount)}</b>runs
            </span>
            <span>
              <b>{fmtTime(recordOf(m))}</b>record
            </span>
            <span>
              <b>{fmtN(m.sessions)}</b>plays
            </span>
          </div>
          <div className="car-pod">
            {m.top3.map((x, i) => (
              <PodLine key={i} p={x} i={i} />
            ))}
          </div>
          <div className="car-acts">
            <Link className="go" href={mapHref(m.pfid)}>
              See the leaderboard
            </Link>
            <span className="car-nav">
              <button
                type="button"
                aria-label="Previous pick"
                onClick={() => {
                  step(-1);
                }}
              >
                &larr;
              </button>
              <span>
                {slide + 1} / {picks.length}
              </span>
              <button
                type="button"
                aria-label="Next pick"
                onClick={() => {
                  step(1);
                }}
              >
                &rarr;
              </button>
            </span>
          </div>
          <div className="car-line">
            <i className="prog"></i>
          </div>
        </div>
      </div>
    </div>
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
  picks,
  shelves,
  asOf,
}: {
  picks: ReadonlyArray<Pick>;
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
            <Carousel picks={picks} now={now} />
            <Shelves shelves={shelves} now={now} />
          </>
        )}
      </div>
    </>
  );
}
