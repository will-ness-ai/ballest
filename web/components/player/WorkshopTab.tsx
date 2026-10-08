"use client";
// A player's Workshop tab: the trophy shelf (which doubles as the Medal filter), one line
// of totals, two shelves, then every Map they finished, with its search, sort and "show
// more". Drawn on the server from the record's finishes, then run here.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PW_CHUNK, usePlayerView, type PwSort } from "./usePlayerView";
import { MapImage } from "../MapImage";
import { useDebounced } from "../../hooks/client";
import type { PlayerRecord, WorkshopFinish } from "../../lib/player";
import { boardHref } from "../../lib/routes";
import {
  MEDAL_KEYS,
  MEDAL_LABEL,
  fmtN,
  fmtTime,
  ord,
  personaOf,
  plural,
  shortGap,
  type MedalKey,
} from "../../lib/rules";

const PW_SHELF = 14;
/* a scripted scroll glides only for those who haven't asked for less motion */
const glide = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: no-preference)").matches ? "smooth" : "auto";

/* a Medal as the trophy shelf and each row draw it */
function Medal({ t, size, mini }: { t: MedalKey; size: number; mini?: boolean }) {
  return (
    <span
      className={mini ? "medal mini" : "medal"}
      data-t={t}
      style={{ "--s": String(size) + "px" } as React.CSSProperties}
      title={MEDAL_LABEL[t]}
    >
      {t === "wr" ? "1" : ""}
    </span>
  );
}

type Cmp = (a: WorkshopFinish, b: WorkshopFinish) => number;
const SORTS: Record<PwSort, [string, Cmp]> = {
  /* the share of the field ahead of them, so every record is 0; biggest board first among equals */
  best: [
    "Best placing",
    (a, b) => (a.rank - 1) / a.field - (b.rank - 1) / b.field || b.field - a.field,
  ],
  rank: ["Highest rank", (a, b) => a.rank - b.rank || b.field - a.field],
  close: [
    "Closest to the record",
    (a, b) => Number(a.rank === 1) - Number(b.rank === 1) || a.gap / a.score - b.gap / b.score,
  ],
  runs: ["Most runs", (a, b) => b.field - a.field],
  newest: ["Newest maps", (a, b) => b.created - a.created],
  az: ["A to Z", (a, b) => a.display.localeCompare(b.display)],
};

const fieldPos = (f: WorkshopFinish) =>
  f.field > 1 ? Math.min(100, ((f.rank - 1) / (f.field - 1)) * 100) : 0;

/* an arrow greys out at its end; a shelf that fits on screen has none */
function Shelf({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ hidden: false, start: true, end: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => {
      const end = el.scrollWidth - el.clientWidth;
      setAt({ hidden: end <= 1, start: el.scrollLeft <= 1, end: el.scrollLeft >= end - 1 });
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      removeEventListener("resize", check);
    };
  }, []);
  const scroll = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: glide() });
  };
  return (
    <section className="shelf">
      <div className="shelf-h">
        <h2>{title}</h2>{" "}
        <span className="snav" hidden={at.hidden}>
          <button
            type="button"
            data-shelf="-1"
            aria-label="Scroll left"
            disabled={at.start}
            onClick={() => {
              scroll(-1);
            }}
          >
            &larr;
          </button>{" "}
          <button
            type="button"
            data-shelf="1"
            aria-label="Scroll right"
            disabled={at.end}
            onClick={() => {
              scroll(1);
            }}
          >
            &rarr;
          </button>
        </span>
      </div>{" "}
      <div className="strip" ref={strip}>
        {children}
      </div>
    </section>
  );
}

function ShelfCard({
  f,
  id,
  children,
}: {
  f: WorkshopFinish;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="scard" href={boardHref(f.name, id)}>
      <span className="top">
        <MapImage preview={f.preview} frame />
        <span>
          <b>{f.display}</b>
          <span className="by">{"by " + f.creator}</span>
        </span>
      </span>{" "}
      {children}
    </Link>
  );
}

function Row({ f, id }: { f: WorkshopFinish; id: string }) {
  return (
    <Link className="wrow" href={boardHref(f.name, id)}>
      <MapImage preview={f.preview} frame />{" "}
      <span className="wt">
        <b>{f.display}</b>
        <small>{"by " + f.creator}</small>{" "}
        <span className="fbar">
          <i style={{ left: fieldPos(f).toFixed(1) + "%" }}></i>
        </span>
      </span>{" "}
      <span className="wrk" data-m={f.rank <= 3 ? f.rank : 0}>
        {f.rank}
        <sup>{ord(f.rank).slice(-2)}</sup>
        <small>{"/" + fmtN(f.field)}</small>
      </span>{" "}
      <span className="wtm">
        {fmtTime(f.score)}
        <small>{f.rank === 1 ? "record" : shortGap(f.gap)}</small>
      </span>{" "}
      <Medal t={f.medal} size={18} mini />
    </Link>
  );
}

export function WorkshopTab({ id, w }: { id: string; w: PlayerRecord["workshop"] }) {
  const [pw, setPw] = usePlayerView(id);
  /* the search box's text, which reaches the view (and starts the list over) once it settles */
  const [text, setText] = useState(pw.q);
  const settled = useDebounced(text);
  if (settled !== pw.q) setPw((p) => ({ ...p, q: settled, shown: PW_CHUNK }));
  if (!w.finishes.length)
    return (
      <div className="pws">
        <div className="empty">
          <b>No Workshop times yet.</b>
        </div>
      </div>
    );
  const recs = w.finishes.filter((f) => f.rank === 1).sort((a, b) => b.field - a.field);
  const close = w.finishes.filter((f) => f.rank > 1).sort((a, b) => a.gap - b.gap);
  const q = pw.q.trim().toLowerCase();
  const rows = w.finishes
    .filter(
      (f) =>
        (!pw.medal || f.medal === pw.medal) &&
        (!q || (f.display + " " + f.creator).toLowerCase().includes(q)),
    )
    .sort(SORTS[pw.sort][1]);
  const pickMedal = (k: MedalKey) => {
    const medal = pw.medal === k ? null : k;
    setPw({ ...pw, medal, shown: PW_CHUNK });
    if (medal)
      document.getElementById("pwall")?.scrollIntoView({ behavior: glide(), block: "start" });
  };
  return (
    <div className="pws">
      <div className="trophies" id="pwtro">
        {MEDAL_KEYS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-medal={k}
            aria-pressed={pw.medal === k}
            data-zero={w.medals[k] ? undefined : ""}
            onClick={() => {
              pickMedal(k);
            }}
          >
            <Medal t={k} size={40} />
            <b data-tc={k}>{fmtN(w.medals[k])}</b> <span className="eyebrow">{label}</span>
          </button>
        ))}
      </div>{" "}
      <p className="wsline">
        {`${fmtN(w.finishes.length)} of ${fmtN(w.maps)} maps finished · ${plural(w.podiums, "podium", "podiums")} · ${fmtN(w.near)} within a second of a record`}
      </p>{" "}
      {recs.length ? (
        <Shelf
          title={
            <>
              World records <span className="shelf-n">{fmtN(recs.length)}</span>
            </>
          }
        >
          {recs.slice(0, PW_SHELF).map((f) => (
            <ShelfCard key={f.name} f={f} id={id}>
              <span className="fig">
                <b data-tc="wr">1st</b>
                {` of ${fmtN(f.field)} · ${fmtTime(f.score)}`}
              </span>
            </ShelfCard>
          ))}
        </Shelf>
      ) : null}{" "}
      {close.length ? (
        <Shelf title="Closest to a record">
          {close.slice(0, PW_SHELF).map((f) => (
            <ShelfCard key={f.name} f={f} id={id}>
              <span className="big">{shortGap(f.gap)}</span>
              <span className="by">
                {`${ord(f.rank)} of ${fmtN(f.field)}, record by ${personaOf(f.holder)}`}
              </span>
            </ShelfCard>
          ))}
        </Shelf>
      ) : null}{" "}
      <h2 className="pwall" id="pwall">
        {"All " + plural(w.finishes.length, "map", "maps")}
      </h2>{" "}
      <div className="pwtools">
        <input
          className="ws-q"
          id="pwq"
          type="search"
          placeholder="Search maps or makers"
          aria-label="Search this player's maps by title or maker"
          autoComplete="off"
          defaultValue={pw.q}
          onInput={(e) => {
            setText(e.currentTarget.value);
          }}
        />{" "}
        <select
          className="pwsort"
          id="pwsort"
          aria-label="Sort maps"
          value={pw.sort}
          onChange={(e) => {
            setPw({ ...pw, sort: e.currentTarget.value as PwSort, shown: PW_CHUNK });
          }}
        >
          {Object.entries(SORTS).map(([k, [label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>{" "}
        <span className="pwbar" id="pwbar">
          {pw.medal ? (
            <button
              type="button"
              className="chip"
              data-pwclear=""
              onClick={() => {
                setPw({ ...pw, medal: null, shown: PW_CHUNK });
              }}
            >
              {MEDAL_LABEL[pw.medal]} only &times;
            </button>
          ) : null}{" "}
          <span className="ws-count">{plural(rows.length, "map", "maps")}</span>
        </span>
      </div>{" "}
      <div id="pwrows">
        {!rows.length ? (
          <div className="empty">
            <b>No map matches.</b>
          </div>
        ) : (
          <>
            <div className="wlist">
              {rows.slice(0, pw.shown).map((f) => (
                <Row key={f.name} f={f} id={id} />
              ))}
            </div>
            {rows.length > pw.shown ? (
              <button
                type="button"
                className="more-btn"
                data-pwmore=""
                onClick={() => {
                  setPw({ ...pw, shown: pw.shown + PW_CHUNK });
                }}
              >
                {`Show ${String(Math.min(PW_CHUNK, rows.length - pw.shown))} more`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
