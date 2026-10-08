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
  ["A", "Fourth plate", "a You plate after the top 3, plus your line on the graph"],
  ["B", "Sticky bar", "a bar pinned to the bottom of the screen while you're on the board"],
  ["C", "Your run card", "a card in the Map panel / under the Track card: Medal, next Medal"],
  ["D", "Graph only", "just your line on the graph with a callout, and a jump link"],
  ["E", "Banner", "one sentence across the top of the board, with a jump button"],
] as const;
export const HEADERS = [
  ["1", "Chip", "marble and name in a pill, top right"],
  ["2", "Marble + menu", "just your marble top right; tap for a small menu"],
  ["3", "Tab", "a You tab at the end of the tabs row"],
  ["4", "Floating", "a marble button pinned bottom-left on every page"],
  ["5", "Mini card", "name plus two headline stats, top right"],
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
const useVariant = () => useParam("variant", "A");
const useHeader = () => useParam("header", "1");
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
export type Place = "plates" | "panel" | "top" | "sticky";
const OWNER: Record<string, Place> = { A: "plates", B: "sticky", C: "panel", D: "top", E: "top" };

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
  if (OWNER[variant] !== place) return null;
  if (variant === "D" && place === "top") return <JumpLink you={you} name={b.name} keep={keep} />;
  if (you.kind === "loading") return null;
  if (you.kind === "unset")
    return variant === "D" ? null : (
      <div className={"you-" + variant + " you-empty"}>
        <span>
          Mark yourself with <b>This is me</b> on your player page to see your run here.
        </span>{" "}
        <Link className="go" href={keep(playersHref("all", "wr"))}>
          Find yourself
        </Link>
      </div>
    );
  if (you.kind === "unplayed")
    return (
      <div className={"you-" + variant + " you-empty"}>
        <span>You haven&apos;t set a time here yet.</span>
      </div>
    );
  const row = you.row;
  const f = facts(b, row);
  const jump = keep(boardHref(b.name, you.id));
  const score = f.points ? fmtN(row.score) + " pts" : fmtTime(row.score);
  switch (variant) {
    case "A":
      return (
        <div className="plate you-plate" data-id={you.id}>
          <Marble who={row} />
          <span className="pl-text">
            <span className="pl-name">You</span>
            <span className="pl-score">{score}</span>
            <span className="pl-gap">
              {row.rank === 1 ? "sets the pace" : "+" + gapText(f.points, f.gap) + " back"}
            </span>
          </span>
          <Link className="pl-rank you-rank" href={jump}>
            {ord(row.rank)}
          </Link>
        </div>
      );
    case "B":
      return (
        <div className="you-B">
          <Marble who={row} />
          <span className="you-B-t">
            <b>You · {ord(row.rank)}</b>
            <small>
              {score}
              {row.rank > 1 ? " · +" + gapText(f.points, f.gap) + " back" : " · record"}
              {f.medal ? " · " + MEDAL_N[f.medal] : ""}
            </small>
          </span>
          <Link className="go" href={jump}>
            Jump to me
          </Link>
        </div>
      );
    case "C":
      return (
        <div className="you-C">
          <span className="eyebrow">{f.points ? "Your standing" : "Your run"}</span>
          <div className="you-C-top">
            <Marble who={row} />
            <b className="you-C-time">{score}</b>
            {f.medal && (
              <span className="you-medal" style={{ color: MEDAL_C[f.medal] }}>
                {MEDAL_N[f.medal]}
              </span>
            )}
          </div>
          <dl className="mp-facts">
            <div>
              <dt>Place</dt>
              <dd>
                {ord(row.rank)} of {fmtN(b.total)}
              </dd>
            </div>
            <div>
              <dt>Field</dt>
              <dd>{f.pct}</dd>
            </div>
            <div>
              <dt>Off the record</dt>
              <dd>{row.rank === 1 ? "—" : gapText(f.points, f.gap)}</dd>
            </div>
            {f.next && (
              <div>
                <dt>To {f.next.name}</dt>
                <dd style={{ color: f.next.c }}>{fmtTime(f.next.by)}</dd>
              </div>
            )}
          </dl>
          <Link className="go" href={jump}>
            Jump to my row
          </Link>
        </div>
      );
    case "E":
      return (
        <div className="you-E">
          <Marble who={row} />
          <p>
            You&apos;re <b>{ord(row.rank)}</b> of {fmtN(b.total)} with <b>{score}</b>
            {f.medal && f.medal !== "none" && (
              <>
                {" "}
                for <b style={{ color: MEDAL_C[f.medal] }}>{MEDAL_N[f.medal]}</b>
              </>
            )}
            {row.rank > 1 ? <>, {gapText(f.points, f.gap)} off the record</> : null}
            {f.next ? (
              <>
                {" "}
                and <b style={{ color: f.next.c }}>{fmtTime(f.next.by)}</b> off {f.next.name}
              </>
            ) : null}
            .
          </p>
          <Link className="go" href={jump}>
            Jump to my row
          </Link>
        </div>
      );
  }
  return null;
}

function JumpLink({
  you,
  name,
  keep,
}: {
  you: YouOnBoard;
  name: string;
  keep: (h: string) => string;
}) {
  if (you.kind !== "played") return null;
  return (
    <p className="you-D">
      <Link href={keep(boardHref(name, you.id))}>Jump to you ({ord(you.row.rank)}) &darr;</Link>
    </p>
  );
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
  const variant = useVariant();
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
              callout: variant === "D" ? ord(row.rank) + " · " + fmtTime(row.score) : null,
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
  const [open, setOpen] = useState(false);
  if ((h === "3") !== (at === "tabs")) return null;
  if (!id)
    return (
      <Link className={"you-h you-h" + h + " you-h-empty"} href={keep(playersHref("all", "wr"))}>
        {h === "2" || h === "4" ? "?" : "Find yourself"}
      </Link>
    );
  if (!rec) return null;
  const href = keep(playerHref(rec.id));
  switch (h) {
    case "1":
      return (
        <Link className="you-h you-h1" href={href}>
          <Still id={rec.id} />
          <span>{personaOf(rec.who)}</span>
        </Link>
      );
    case "2":
      return (
        <span className="you-h you-h2">
          <button
            type="button"
            className="you-h2-b"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <Still id={rec.id} />
          </button>
          {open && (
            <span className="you-menu">
              <b>{personaOf(rec.who)}</b>
              <Link href={href}>Your page</Link>
              <Link href={keep(playerHref(rec.id, "workshop"))}>Your Workshop times</Link>
              <Link href={keep(playerHref(rec.id, "circuit"))}>Your Circuit times</Link>
            </span>
          )}
        </span>
      );
    case "3":
      return (
        <Link className="you-h you-h3 gtab" href={href}>
          <Still id={rec.id} /> You
        </Link>
      );
    case "4":
      return (
        <Link className="you-h you-h4" href={href} aria-label="Your page">
          <Still id={rec.id} />
        </Link>
      );
    case "5":
      return (
        <Link className="you-h you-h5" href={href}>
          <Still id={rec.id} />
          <span>
            <b>{personaOf(rec.who)}</b>
            <small>
              {rec.allSeasons ? ord(rec.allSeasons.rank) + " All Seasons" : "Unranked"} ·{" "}
              {fmtN(rec.workshop.maps)} Maps
            </small>
          </span>
        </Link>
      );
  }
  return null;
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
