"use client";
/* ==========================================================================
   PROTOTYPE (grill-design, "You" round 1). Never merged: the winner is rebuilt
   properly by /implement-spec. Everything for the round lives in this file and
   app/styles/proto.css.

   ?variant=  how You shows on a Map / Track / Overall board (A..E)
   ?header=   the header button that takes you to your page (1..5)
   ?state=    mine (this browser's "This is me"), demo (a mid-board player),
              unplayed (You set, no time on this board), unset (nobody claimed)
   ========================================================================== */
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Ball, Marble } from "../Marble";
import { Spread } from "../board/Spread";
import { useMe } from "../../hooks/me";
import type { PlayerRecord } from "../../lib/player";
import type { BoardPage, BoardRow } from "../../lib/rows";
import { boardHref, playerHref, playersHref } from "../../lib/routes";
import {
  MEDALS,
  SCORE_TICKS_PER_SECOND,
  fmtN,
  fmtTime,
  isPoints,
  medalOf,
  ord,
  pctOf,
  hueFor,
  personaOf,
} from "../../lib/rules";

/* a player in the middle of most boards, for when this browser has claimed nobody */
const DEMO_ID = "76561198008697957";

export const VARIANTS = [
  ["E1", "Sentence", "round 1's banner: one sentence, then Jump to my row"],
  ["E2", "Sentence + next Medal", "shorter sentence, with a bar toward the next Medal"],
  ["E3", "Stat chips", "the same facts as labelled chips instead of a sentence"],
  ["E4", "Pinned row", "your row from the list, pinned above the board; tap it to jump"],
  ["E5", "Big, above the card", "a larger banner at the very top, above the Track card"],
] as const;
export const HEADERS = [
  ["P1", "Card, stats shown", "phone: the whole mini card, stats included, where Refreshed was"],
  ["P2", "Name chip", "phone: marble and name only; desktop keeps the card"],
  ["P3", "Marble only", "phone: just your marble; desktop keeps the card"],
  ["P4", "Own row", "phone: the card as a full-width row under the brand; Refreshed stays"],
  ["P5", "Stats, no name", "phone: marble plus rank and Maps, no name"],
] as const;
const STATES = ["mine", "demo", "unplayed", "unset"] as const;
type State = (typeof STATES)[number];

/* ---- the URL is the picker's state ---- */
const urlListeners = new Set<() => void>();
function setParam(k: string, v: string) {
  const u = new URL(location.href);
  u.searchParams.set(k, v);
  history.replaceState(history.state, "", u.toString());
  for (const l of urlListeners) l();
}
function useParam(k: string, fallback: string) {
  const v = useSyncExternalStore(
    (cb) => {
      urlListeners.add(cb);
      addEventListener("popstate", cb);
      return () => {
        urlListeners.delete(cb);
        removeEventListener("popstate", cb);
      };
    },
    () => new URLSearchParams(location.search).get(k),
    () => null,
  );
  return v ?? fallback;
}
const useVariant = () => useParam("variant", "E1");
const useHeader = () => useParam("header", "P1");
function useState_(): State {
  const me = useMe();
  const s = useParam("state", "") as State | "";
  return STATES.includes(s as State) ? (s as State) : me ? "mine" : "demo";
}

/* the Steam ID that counts as You for this state */
function useYouId() {
  const me = useMe();
  const s = useState_();
  if (s === "unset") return null;
  if (s === "mine") return me;
  return DEMO_ID;
}

/* keep the prototype's params on every link it draws */
function useKeep() {
  const v = useVariant(),
    h = useHeader(),
    s = useParam("state", "");
  return (href: string) =>
    href + "?" + new URLSearchParams({ variant: v, header: h, ...(s ? { state: s } : {}) });
}

/* ---- reads ---- */
const RECS = new Map<string, Promise<PlayerRecord | null>>();
function useRecord(id: string | null) {
  const [rec, setRec] = useState<PlayerRecord | null>(null);
  useEffect(() => {
    if (!id) return;
    let p = RECS.get(id);
    if (!p) {
      p = fetch("/api/player/" + id)
        .then((r) => (r.ok ? (r.json() as Promise<PlayerRecord>) : null))
        .catch(() => null);
      RECS.set(id, p);
    }
    let live = true;
    void p.then((r) => {
      if (live) setRec(r);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return rec?.id === id ? rec : null;
}

type YouOnBoard =
  | { kind: "unset" }
  | { kind: "loading" }
  | { kind: "unplayed"; id: string }
  | { kind: "played"; id: string; row: BoardRow };

function useYouOnBoard(name: string): YouOnBoard {
  const id = useYouId();
  const s = useState_();
  const [got, setGot] = useState<{ key: string; row: BoardRow | null } | null>(null);
  const key = name + "|" + (id ?? "");
  useEffect(() => {
    if (!id || s === "unplayed") return;
    let live = true;
    void fetch(`/api/board/${encodeURIComponent(name)}?q=${id}&count=5`)
      .then((r) => (r.ok ? (r.json() as Promise<BoardPage>) : null))
      .catch(() => null)
      .then((p) => {
        if (live) setGot({ key, row: p?.rows.find((r) => r.steamId === id) ?? null });
      });
    return () => {
      live = false;
    };
  }, [id, name, key, s]);
  if (!id) return { kind: "unset" };
  if (s === "unplayed") return { kind: "unplayed", id };
  if (got?.key !== key) return { kind: "loading" };
  return got.row ? { kind: "played", id, row: got.row } : { kind: "unplayed", id };
}

/* mark your row in the list, wherever it is drawn */
function useMarkRow(id: string | null) {
  useEffect(() => {
    const mark = () => {
      for (const el of document.querySelectorAll(".row.is-you, .plate.is-you"))
        el.classList.remove("is-you");
      if (!id) return;
      for (const el of document.querySelectorAll(`.row[data-id="${id}"], .plate[data-id="${id}"]`))
        el.classList.add("is-you");
    };
    mark();
    const board = document.querySelector(".content");
    if (!board) return;
    const mo = new MutationObserver(mark);
    mo.observe(board, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
    };
  }, [id]);
}

/* ---- the board: one slot per place a variant can put You ---- */
export type Place = "plates" | "panel" | "top" | "sticky" | "head";

interface BoardFacts {
  name: string;
  total: number;
  lead: number | null;
  medals: ReadonlyArray<number> | null;
}

function gapText(points: boolean, gap: number) {
  return points ? fmtN(gap) + " pts" : fmtTime(gap);
}

function facts(b: BoardFacts, row: BoardRow) {
  const points = isPoints(b.name);
  const gap = b.lead == null ? 0 : points ? b.lead - row.score : row.score - b.lead;
  const medal = b.medals ? medalOf(b.medals, row.rank, row.score) : null;
  /* the next Medal up and how far off it you are */
  let next: { name: string; c: string; by: number } | null = null;
  if (b.medals && medal !== "wr")
    for (const [name, c, i] of [...MEDALS].reverse()) {
      const t = b.medals[i] * SCORE_TICKS_PER_SECOND;
      if (row.score > t) {
        next = { name, c, by: row.score - t };
        break;
      }
    }
  return { points, gap, medal, next, pct: pctOf(row.rank, b.total) };
}

const MEDAL_C: Record<string, string> = {
  wr: "var(--accent)",
  author: "var(--author)",
  gold: "var(--gold)",
  silver: "var(--silver)",
  bronze: "var(--bronze)",
  none: "var(--faint)",
};
const MEDAL_N: Record<string, string> = {
  wr: "World record",
  author: "Author",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  none: "No medal",
};

export function YouSlot({ place, ...b }: BoardFacts & { place: Place }) {
  const variant = useVariant();
  const you = useYouOnBoard(b.name);
  const keep = useKeep();
  useMarkRow(you.kind === "played" ? you.id : null);
  if ((variant === "E5" ? "head" : "top") !== place) return null;
  if (you.kind === "loading") return null;
  const cls = "you-E you-" + variant;
  if (you.kind === "unset")
    return (
      <div className={cls + " you-empty"}>
        <p>
          Mark yourself with <b>This is me</b> on your player page and your run shows up here.
        </p>
        <Link className="go" href={keep(playersHref("all", "wr"))}>
          Find yourself
        </Link>
      </div>
    );
  if (you.kind === "unplayed")
    return (
      <div className={cls + " you-empty"}>
        <p>You haven&apos;t set a time here yet.</p>
      </div>
    );
  const row = you.row;
  const f = facts(b, row);
  const jump = keep(boardHref(b.name, you.id));
  const score = f.points ? fmtN(row.score) + " pts" : fmtTime(row.score);
  const medal =
    f.medal && f.medal !== "none" && f.medal !== "wr" ? (
      <b style={{ color: MEDAL_C[f.medal] }}>{MEDAL_N[f.medal]}</b>
    ) : null;
  const go = (
    <Link className="go" href={jump}>
      Jump to my row
    </Link>
  );
  switch (variant) {
    case "E1":
      return (
        <div className={cls}>
          <Marble who={row} />
          <p>
            You&apos;re <b>{ord(row.rank)}</b> of {fmtN(b.total)} with <b>{score}</b>
            {medal && <> for {medal}</>}
            {row.rank > 1 ? <>, {gapText(f.points, f.gap)} off the record</> : <>: the record</>}
            {f.next ? (
              <>
                {" "}
                and <b style={{ color: f.next.c }}>{fmtTime(f.next.by)}</b> off {f.next.name}
              </>
            ) : null}
            .
          </p>
          {go}
        </div>
      );
    case "E2": {
      /* how far through the Medal you're chasing: from the one you hold to the next */
      let bar: React.ReactNode = null;
      if (f.next && b.medals) {
        const order = [0, 1, 2, 3].map(
          (i) => (b.medals as ReadonlyArray<number>)[i] * SCORE_TICKS_PER_SECOND,
        );
        const held = order.filter((t) => row.score <= t);
        const from = held.length ? Math.min(...held) : b.medals[0] * SCORE_TICKS_PER_SECOND * 1.5;
        const to = row.score - f.next.by;
        const done = Math.max(0.04, Math.min(1, (from - row.score) / (from - to)));
        bar = (
          <span className="you-prog">
            <span style={{ width: (done * 100).toFixed(0) + "%", background: f.next.c }} />
          </span>
        );
      }
      return (
        <div className={cls}>
          <Marble who={row} />
          <p>
            You&apos;re <b>{ord(row.rank)}</b> of {fmtN(b.total)} with <b>{score}</b>
            {medal && <> for {medal}</>}.
            {f.next && (
              <span className="you-next">
                {bar}
                <small>
                  <b style={{ color: f.next.c }}>{fmtTime(f.next.by)}</b> to {f.next.name}
                </small>
              </span>
            )}
          </p>
          {go}
        </div>
      );
    }
    case "E3":
      return (
        <div className={cls}>
          <Marble who={row} />
          <span className="you-chips">
            <span>
              <small>Place</small>
              <b>{ord(row.rank)}</b>
            </span>
            <span>
              <small>{f.points ? "Points" : "Time"}</small>
              <b>{score}</b>
            </span>
            {f.medal && (
              <span>
                <small>Medal</small>
                <b style={{ color: MEDAL_C[f.medal] }}>{MEDAL_N[f.medal]}</b>
              </span>
            )}
            <span>
              <small>Field</small>
              <b>{f.pct}</b>
            </span>
            {row.rank > 1 && (
              <span>
                <small>Off the record</small>
                <b>{gapText(f.points, f.gap)}</b>
              </span>
            )}
            {f.next && (
              <span>
                <small>To {f.next.name}</small>
                <b style={{ color: f.next.c }}>{fmtTime(f.next.by)}</b>
              </span>
            )}
          </span>
          {go}
        </div>
      );
    case "E4":
      return (
        <div className={cls}>
          <span className="eyebrow">You</span>
          <Link className="you-pin" href={jump}>
            <span className="c-rank">{row.rank}</span>
            <Marble who={row} />
            <span className="you-pin-t">
              <b>{personaOf(row)}</b>
              <small>
                {row.rank > 1 ? "+" + gapText(f.points, f.gap) + " behind" : "Leads the board"}
                {f.next ? " · " + fmtTime(f.next.by) + " to " + f.next.name : ""}
              </small>
            </span>
            <span className="you-pin-s">
              {score}
              {medal && <i style={{ background: MEDAL_C[f.medal as string] }} />}
            </span>
          </Link>
        </div>
      );
    case "E5":
      return (
        <div className={cls}>
          <Marble who={row} />
          <div className="you-hero">
            <span className="eyebrow">Your run</span>
            <b className="you-hero-t">{score}</b>
            <p>
              {ord(row.rank)} of {fmtN(b.total)}
              {medal && <> · {medal}</>}
              {row.rank > 1 ? <> · {gapText(f.points, f.gap)} off the record</> : null}
              {f.next ? (
                <>
                  {" "}
                  · <b style={{ color: f.next.c }}>{fmtTime(f.next.by)}</b> to {f.next.name}
                </>
              ) : null}
            </p>
          </div>
          {go}
        </div>
      );
  }
  return null;
}

/* the graph, with your run drawn in: every variant shows it */
export function YouSpread({
  name,
  ts,
  medals,
  wide,
}: {
  name: string;
  ts: ReadonlyArray<number>;
  medals: ReadonlyArray<number>;
  wide: boolean;
}) {
  const you = useYouOnBoard(name);
  const row = you.kind === "played" ? you.row : null;
  return (
    <Spread
      ts={ts}
      medals={medals}
      wide={wide}
      you={
        row
          ? {
              score: row.score,
              h: row.steamId,
              callout: null,
            }
          : null
      }
    />
  );
}

/* ---- the header ---- */
/* a marble that is not a button, for inside a link */
function Still({ id }: { id: string }) {
  const h = hueFor(id);
  return (
    <span className="marble" style={{ "--h": h } as React.CSSProperties}>
      <Ball h={h} />
    </span>
  );
}

export function YouHeader({ at }: { at: "hdr" | "tabs" }) {
  const h = useHeader();
  const id = useYouId();
  const rec = useRecord(id);
  const keep = useKeep();
  if (at !== "hdr") return null;
  const cls = "you-h you-h5 you-" + h;
  if (!id)
    return (
      <Link className={cls + " you-h-empty"} href={keep(playersHref("all", "wr"))}>
        <span className="you-q">?</span>
        <span>
          <b>Find yourself</b>
          <small>Mark your page with This is me</small>
        </span>
      </Link>
    );
  if (!rec) return null;
  return (
    <Link className={cls} href={keep(playerHref(rec.id))}>
      <Still id={rec.id} />
      <span>
        <b>{personaOf(rec.who)}</b>
        <small>
          <span className="you-r">
            {rec.allSeasons ? ord(rec.allSeasons.rank) + " All Seasons" : "Unranked"}
          </span>
          <span className="you-r-short">
            {rec.allSeasons ? ord(rec.allSeasons.rank) : "Unranked"}
          </span>{" "}
          · {fmtN(rec.workshop.maps)} Maps
        </small>
      </span>
    </Link>
  );
}

/* ---- the picker: plainly not part of the design ---- */
export function Picker() {
  const v = useVariant(),
    h = useHeader(),
    s = useState_();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const vi = Math.max(
    0,
    VARIANTS.findIndex((x) => x[0] === v),
  );
  const hi = Math.max(
    0,
    HEADERS.findIndex((x) => x[0] === h),
  );
  const step = (
    list: ReadonlyArray<readonly [string, string, string]>,
    i: number,
    d: number,
    k: string,
  ) => setParam(k, list[(i + d + list.length) % list.length][0]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const d = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey) step(HEADERS, hi, d, "header");
      else step(VARIANTS, vi, d, "variant");
    };
    addEventListener("keydown", key);
    return () => {
      removeEventListener("keydown", key);
    };
  }, [vi, hi]);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - box.left,
      dy = e.clientY - box.top;
    const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <div
      className="proto-picker"
      onPointerDown={drag}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
    >
      <div>
        <button type="button" onClick={() => step(VARIANTS, vi, -1, "variant")}>
          ←
        </button>
        <span title={VARIANTS[vi][2]}>
          Board {VARIANTS[vi][0]} · {VARIANTS[vi][1]}
        </span>
        <button type="button" onClick={() => step(VARIANTS, vi, 1, "variant")}>
          →
        </button>
      </div>
      <div>
        <button type="button" onClick={() => step(HEADERS, hi, -1, "header")}>
          ←
        </button>
        <span title={HEADERS[hi][2]}>
          Header {HEADERS[hi][0]} · {HEADERS[hi][1]}
        </span>
        <button type="button" onClick={() => step(HEADERS, hi, 1, "header")}>
          →
        </button>
      </div>
      <div className="proto-states">
        {STATES.map((x) => (
          <button key={x} type="button" aria-pressed={s === x} onClick={() => setParam("state", x)}>
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}
