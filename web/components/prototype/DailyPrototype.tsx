"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 1 (calendar) settled where Dailies live, round 2 (picture + winner) what a calendar
// day shows. Round 3: the selected day's panel. Five variants on /daily, picked by
// ?variant=, with ?state= switching between a quiet and a busy today.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { mapHref } from "../../lib/routes";
import {
  MEDALS,
  SCORE_TICKS_PER_SECOND,
  fmtN,
  fmtSec,
  fmtTime,
  hueFor,
  medalOf,
  shortGap,
} from "../../lib/rules";
import {
  type DEntry,
  type DState,
  type Daily,
  dailiesFor,
  dayLabel,
  left,
  standings,
} from "./daily-data";

type Previews = Record<string, string | null>;

const VARIANTS = [
  [
    "A",
    "Picture card",
    "Round 2's panel: the map's picture beside the day's facts, then the board.",
  ],
  [
    "B",
    "Board first",
    "No picture: one header line (date, map, players, when it ends or closed), then a longer board.",
  ],
  ["C", "Podium", "The top three on a podium over the map's picture, then the board from 4th."],
  [
    "D",
    "Medals",
    "The picture card with the Map's four Medal times and how many earned each; every row shows its Medal.",
  ],
  [
    "E",
    "Day in numbers",
    "No picture: tiles for players, winning margin, median time and Author Medals beaten, then the board.",
  ],
] as const;
type VKey = (typeof VARIANTS)[number][0];

/* ---------- shared pieces ---------- */

function DRow({
  e,
  lead,
  prev,
  live,
  medal,
}: {
  e: DEntry;
  lead: number;
  prev: number | null;
  live?: boolean;
  medal?: string;
}) {
  const [rank, steamId, persona, score] = e;
  return (
    <div
      className="row"
      style={{ "--h": hueFor(steamId) } as React.CSSProperties}
      data-m={rank <= 3 ? rank : 0}
    >
      <span className="c-rank">{rank}</span>
      <Marble who={{ steamId, persona }} />
      <span className="c-text">
        <span className="nm">
          <PlayerLink id={steamId} text={persona} />
        </span>
        <span className="sub">
          {rank === 1 ? (
            live ? (
              "Leading"
            ) : (
              "Won the day"
            )
          ) : (
            <>
              <em>{shortGap(score - lead)}</em> behind
              {prev !== null && (
                <>
                  {" "}
                  · {shortGap(score - prev)} to {rank - 1}
                </>
              )}
            </>
          )}
        </span>
      </span>
      <span className="c-score">
        <span>{fmtTime(score)}</span>
        {medal ? (
          <i className="dp-medal" data-medal={medal}>
            {MEDAL_WORD[medal]}
          </i>
        ) : (
          <i className="pill"></i>
        )}
      </span>
    </div>
  );
}

const MEDAL_WORD: Record<string, string> = {
  wr: "1st",
  author: "Author",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  none: "",
};

function DBoard({
  d,
  limit = 10,
  live,
  medals,
  from = 0,
}: {
  from?: number;
  d: Daily;
  limit?: number;
  live?: boolean;
  medals?: Array<number>;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? d.entries.slice(from) : d.entries.slice(from, from + limit);
  if (!d.entries.length)
    return (
      <div className="board">
        <div className="empty">Nobody finished this Daily.</div>
      </div>
    );
  const lead = d.entries[0][3];
  return (
    <>
      <div className="board">
        <div className="head">
          <span>#</span>
          <span></span>
          <span>Player</span>
          <span className="c-score">Time</span>
        </div>
        {rows.map((e, i) => (
          <DRow
            key={e[1]}
            e={e}
            lead={lead}
            prev={i + from ? d.entries[i + from - 1][3] : null}
            live={live}
            medal={medals ? medalOf(medals, e[0], e[3]) : undefined}
          />
        ))}
      </div>
      {d.entries.length - from > limit && (
        <button className="dp-more" onClick={() => setAll(!all)}>
          {all ? "Show the top " + limit : `Show all ${fmtN(d.entries.length)} times`}
        </button>
      )}
    </>
  );
}

function Countdown({ d, now }: { d: Daily; now: number }) {
  const end = new Date(d.endsAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span className="dp-clock">
      <i className="dp-live"></i>Ends in <b>{left(d.endsAt - now)}</b> · {end} your time
    </span>
  );
}

function Hero({
  d,
  now,
  previews,
  big = true,
}: {
  d: Daily;
  now: number;
  previews: Previews;
  big?: boolean;
}) {
  const top = d.entries[0];
  return (
    <section className={big ? "dp-hero" : "dp-hero dp-hero-s"}>
      <span className="dp-pic">
        <MapImage preview={previews[d.pfid]} />
      </span>
      <div className="dp-hero-t">
        <span className="eyebrow">Today's Daily · {dayLabel(d, { weekday: "short" })}</span>
        <h1>{d.title}</h1>
        <Countdown d={d} now={now} />
        <span className="dp-facts">
          <span>
            <b>{fmtN(d.entries.length)}</b> players so far
          </span>
          {top && (
            <span>
              Leader <b>{top[2]}</b> {fmtTime(top[3])}
            </span>
          )}
        </span>
        <span className="dp-links">
          <Link href={mapHref(d.pfid)}>The Map's all-time board</Link>
        </span>
      </div>
    </section>
  );
}

function Winner({ d }: { d: Daily }) {
  const w = d.entries[0];
  if (!w) return <span className="dp-dim">No finishers</span>;
  return (
    <span className="dp-win">
      <Marble who={{ steamId: w[1], persona: w[2] }} />
      <span className="dp-wn">{w[2]}</span>
      <span className="num">{fmtTime(w[3])}</span>
    </span>
  );
}

/* ---------- B · Calendar ---------- */
function VB({ today, past, now, previews, medals, cell }: VProps & { cell: VKey }) {
  const all = [today, ...past];
  const [sel, setSel] = useState(today.date);
  const d = all.find((x) => x.date === sel) ?? today;
  const months = [...new Set(all.map((x) => x.date.slice(0, 7)))].sort().reverse();
  return (
    <div className="dp dp-cal-wrap">
      <div className="dp-cal-side">
        {months.map((mo) => {
          const [y, m] = mo.split("-").map(Number);
          const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
          const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return (
            <section key={mo} className="dp-month">
              <h2 className="dp-h">
                {new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h2>
              <div className="dp-grid">
                {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
                  <span key={i} className="dp-wd">
                    {w}
                  </span>
                ))}
                {Array.from({ length: first }, (_, i) => (
                  <span key={"b" + i}></span>
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const date = `${mo}-${String(i + 1).padStart(2, "0")}`;
                  const x = all.find((y2) => y2.date === date);
                  if (!x)
                    return (
                      <span key={date} className="dp-cell dp-none">
                        {i + 1}
                      </span>
                    );
                  const w = x.entries[0];
                  return (
                    <button
                      key={date}
                      className="dp-cell"
                      data-cell="A"
                      aria-pressed={sel === date}
                      data-today={x === today}
                      onClick={() => setSel(date)}
                    >
                      <Cell x={x} n={i + 1} cell="A" previews={previews} />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="dp-cal-main">
        <DayPanel
          key={d.date}
          d={d}
          live={d === today}
          now={now}
          previews={previews}
          medals={medals[d.pfid]}
          panel={cell}
        />
      </div>
    </div>
  );
}

/* the selected day, drawn the way this round's variant says */
function DayPanel({
  d,
  live,
  now,
  previews,
  medals,
  panel,
}: {
  d: Daily;
  live: boolean;
  now: number;
  previews: Previews;
  medals: Array<number> | undefined;
  panel: VKey;
}) {
  const when = live ? (
    <Countdown d={d} now={now} />
  ) : (
    <span className="dp-clock">
      Final · closed{" "}
      {new Date(d.endsAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}{" "}
      your time
    </span>
  );
  const eyebrow =
    (live ? "Today's Daily · " : "Daily · ") + dayLabel(d, { weekday: "short", year: "numeric" });
  const n = d.entries.length;
  if (panel === "B")
    return (
      <>
        <div className="dp-line">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{d.title}</h1>
          <span className="dp-facts">
            <span>
              <b>{fmtN(n)}</b> players
            </span>
            {when}
            <Link href={mapHref(d.pfid)}>All-time board</Link>
          </span>
        </div>
        <DBoard d={d} limit={20} live={live} />
      </>
    );
  if (panel === "C") {
    const top = d.entries.slice(0, 3);
    return (
      <>
        <section className="dp-podium">
          <span className="dp-podbg">
            <MapImage preview={previews[d.pfid]} />
          </span>
          <div className="dp-podhead">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{d.title}</h1>
            <span className="dp-facts">
              <span>
                <b>{fmtN(n)}</b> players
              </span>
              {when}
            </span>
          </div>
          <ol className="dp-steps">
            {[top[1], top[0], top[2]].map((e, i) =>
              e ? (
                <li key={e[1]} data-m={e[0]} style={{ "--h": hueFor(e[1]) } as React.CSSProperties}>
                  <Marble who={{ steamId: e[1], persona: e[2] }} />
                  <span className="dp-wn">{e[2]}</span>
                  <span className="num">{fmtTime(e[3])}</span>
                  <b>{e[0]}</b>
                </li>
              ) : (
                <li key={i}></li>
              ),
            )}
          </ol>
        </section>
        <DBoard d={d} from={3} limit={17} live={live} />
      </>
    );
  }
  if (panel === "D") {
    const tiers = medals
      ? MEDALS.map(([name, c, i]) => ({
          name,
          c,
          t: medals[i],
          k: d.entries.filter((e) => e[3] <= medals[i] * SCORE_TICKS_PER_SECOND).length,
        }))
      : [];
    return (
      <>
        <section className="dp-hero dp-hero-s">
          <span className="dp-pic">
            <MapImage preview={previews[d.pfid]} />
          </span>
          <div className="dp-hero-t">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{d.title}</h1>
            {when}
            <div className="dp-medals">
              {tiers.map((m) => (
                <span key={m.name}>
                  <i style={{ background: m.c }}></i>
                  {m.name} <b className="num">{fmtSec(m.t)}</b>
                  <em>
                    {fmtN(m.k)} of {fmtN(n)}
                  </em>
                </span>
              ))}
              {!medals && (
                <span className="dp-dim">
                  This Map is gone from the Workshop, so its Medals are unknown.
                </span>
              )}
            </div>
          </div>
        </section>
        <DBoard d={d} limit={15} live={live} medals={medals} />
      </>
    );
  }
  if (panel === "E") {
    const sc = d.entries.map((e) => e[3]);
    const margin = sc.length > 1 ? sc[1] - sc[0] : null;
    const median = sc.length ? sc[Math.floor(sc.length / 2)] : null;
    const authors = medals
      ? sc.filter((x) => x <= medals[3] * SCORE_TICKS_PER_SECOND).length
      : null;
    return (
      <>
        <div className="dp-line">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{d.title}</h1>
          {when}
        </div>
        <dl className="dp-tiles">
          <div>
            <dt>Players</dt>
            <dd>{fmtN(n)}</dd>
          </div>
          <div>
            <dt>{live ? "Leading by" : "Won by"}</dt>
            <dd>{margin === null ? "-" : shortGap(margin)}</dd>
          </div>
          <div>
            <dt>Median time</dt>
            <dd>{median === null ? "-" : fmtTime(median)}</dd>
          </div>
          <div>
            <dt>Beat the Author</dt>
            <dd>{authors === null ? "-" : fmtN(authors)}</dd>
          </div>
        </dl>
        <DBoard d={d} limit={15} live={live} />
      </>
    );
  }
  return (
    <>
      <section className="dp-hero dp-hero-s">
        <span className="dp-pic">
          <MapImage preview={previews[d.pfid]} />
        </span>
        <div className="dp-hero-t">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{d.title}</h1>
          {when}
          <span className="dp-facts">
            <span>
              <b>{fmtN(n)}</b> players{live ? " so far" : ""}
            </span>
            {d.entries[0] && (
              <span>
                {live ? "Leader" : "Winner"} <b>{d.entries[0][2]}</b> {fmtTime(d.entries[0][3])}
              </span>
            )}
          </span>
          <span className="dp-links">
            <Link href={mapHref(d.pfid)}>The Map's all-time board</Link>
          </span>
        </div>
      </section>
      <DBoard d={d} limit={15} live={live} />
    </>
  );
}

interface VProps {
  today: Daily;
  past: Array<Daily>;
  now: number;
  previews: Previews;
  medals: Record<string, Array<number>>;
}
const VIEWS = Object.fromEntries(
  VARIANTS.map(([k]) => [k, (p: VProps) => <VB {...p} cell={k} />]),
) as Record<VKey, (p: VProps) => React.ReactNode>;

/* one day of the calendar, drawn the way this round's variant says */
function Cell({ x, n, cell, previews }: { x: Daily; n: number; cell: VKey; previews: Previews }) {
  const w = x.entries[0];
  const pic = <MapImage preview={previews[x.pfid]} />;
  const num = <span className="dp-n">{n}</span>;
  if (cell === "B")
    return (
      <>
        {num}
        {w ? (
          <span className="dp-cw">
            <Marble who={{ steamId: w[1], persona: w[2] }} />
            <span className="dp-wn">{w[2]}</span>
            <span className="num">{fmtTime(w[3])}</span>
          </span>
        ) : (
          <span className="dp-cw dp-dim">none</span>
        )}
      </>
    );
  if (cell === "C")
    return (
      <>
        {num}
        <span className="dp-count">{fmtN(x.entries.length)}</span>
        {w && <Marble who={{ steamId: w[1], persona: w[2] }} />}
      </>
    );
  if (cell === "D")
    return (
      <>
        {pic}
        {num}
        <span className="dp-stack">
          {x.entries.slice(0, 3).map((e) => (
            <span key={e[1]} data-m={e[0]}>
              <Marble who={{ steamId: e[1], persona: e[2] }} />
            </span>
          ))}
        </span>
      </>
    );
  if (cell === "E")
    return (
      <>
        {pic}
        {num}
        <span className="dp-title">{x.title}</span>
      </>
    );
  return (
    <>
      {pic}
      {num}
      {w && <Marble who={{ steamId: w[1], persona: w[2] }} />}
    </>
  );
}

/* ---------- the picker ---------- */
function Picker({
  v,
  setV,
  state,
  setState,
}: {
  v: VKey;
  setV: (k: VKey) => void;
  state: DState;
  setState: (s: DState) => void;
}) {
  const i = VARIANTS.findIndex((x) => x[0] === v);
  const step = (n: number) => setV(VARIANTS[(i + n + VARIANTS.length) % VARIANTS.length][0]);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = box.current!.getBoundingClientRect(),
      dx = e.clientX - r.left,
      dy = e.clientY - r.top;
    const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      ref={box}
      className="proto-picker"
      onPointerDown={drag}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
    >
      <div className="pp-row">
        <button onClick={() => step(-1)} aria-label="Previous variant">
          ←
        </button>
        <b>
          {v} · {VARIANTS[i][1]}
        </b>
        <button onClick={() => step(1)} aria-label="Next variant">
          →
        </button>
      </div>
      <p>{VARIANTS[i][2]}</p>
      <div className="pp-row">
        <span>Today:</span>
        <button aria-pressed={state === "quiet"} onClick={() => setState("quiet")}>
          Oct 6, 64 times
        </button>
        <button aria-pressed={state === "busy"} onClick={() => setState("busy")}>
          Oct 5, 271 times
        </button>
      </div>
    </div>
  );
}

export function DailyPrototype({
  previews,
  medals,
}: {
  previews: Previews;
  medals: Record<string, Array<number>>;
}) {
  const sp = useSearchParams();
  const init = (sp.get("variant") ?? "A").toUpperCase();
  const [v, setV] = useState<VKey>(VARIANTS.some((x) => x[0] === init) ? (init as VKey) : "A");
  const [state, setState] = useState<DState>(sp.get("state") === "busy" ? "busy" : "quiet");
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("variant", v);
    u.searchParams.set("state", state);
    window.history.replaceState(window.history.state, "", u);
  }, [v, state]);
  const View = VIEWS[v];
  return (
    <>
      <View {...dailiesFor(state)} previews={previews} medals={medals} />
      <Picker v={v} setV={setV} state={state} setState={setState} />
    </>
  );
}
