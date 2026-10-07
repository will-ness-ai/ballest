"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 1 (calendar) settled where Dailies live, round 2 (picture + winner) what a calendar
// day shows, round 3 (podium, with the all-time board link) the day panel. Round 4: the
// phone layout. Five variants on /daily, picked by
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
    "Stacked",
    "On a phone: every month, then the day panel under them; tapping a day scrolls down to it. Desktop is unchanged in every variant.",
  ],
  [
    "B",
    "Panel first",
    "On a phone: the day panel on top, the months under it; tapping a day scrolls back up to the panel.",
  ],
  [
    "C",
    "One month",
    "One month at a time with ‹ › to change it (on desktop too), the panel under it on a phone.",
  ],
  [
    "D",
    "Day strip",
    "On a phone: a sideways strip of days at the top, newest at the right, with a Calendar button for the full months; the panel under the strip.",
  ],
  [
    "E",
    "Bottom sheet",
    "On a phone: the months fill the page under a Today bar, and tapping a day slides its panel up as a sheet over them.",
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
function Month({
  mo,
  all,
  today,
  sel,
  pick,
  previews,
}: {
  mo: string;
  all: Array<Daily>;
  today: Daily;
  sel: string;
  pick: (date: string) => void;
  previews: Previews;
}) {
  const [y, m] = mo.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return (
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
        return (
          <button
            key={date}
            className="dp-cell"
            aria-pressed={sel === date}
            data-today={x === today}
            onClick={() => pick(date)}
          >
            <Cell x={x} n={i + 1} cell="A" previews={previews} />
          </button>
        );
      })}
    </div>
  );
}

const monthName = (mo: string) =>
  new Date(mo + "-15T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const phone = () =>
  typeof window !== "undefined" && !window.matchMedia("(min-width: 820px)").matches;

function VB({ today, past, now, previews, medals, cell }: VProps & { cell: VKey }) {
  const all = [today, ...past];
  const [sel, setSel] = useState(today.date);
  const [mi, setMi] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [cal, setCal] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const d = all.find((x) => x.date === sel) ?? today;
  const months = [...new Set(all.map((x) => x.date.slice(0, 7)))].sort().reverse();
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const pick = (date: string) => {
    setSel(date);
    setCal(false);
    if (cell === "E" && phone()) setSheet(true);
    if ((cell === "B" || cell === "A" || cell === "C") && phone())
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  };
  const monthsBlock = (cell === "C" ? [months[mi]] : months).map((mo) => (
    <section key={mo} className="dp-month">
      <h2 className="dp-h dp-mh">
        {cell === "C" && (
          <button
            onClick={() => setMi(Math.min(months.length - 1, mi + 1))}
            disabled={mi === months.length - 1}
            aria-label="Earlier month"
          >
            ‹
          </button>
        )}
        <span>{monthName(mo)}</span>
        {cell === "C" && (
          <button
            onClick={() => setMi(Math.max(0, mi - 1))}
            disabled={mi === 0}
            aria-label="Later month"
          >
            ›
          </button>
        )}
      </h2>
      <Month mo={mo} all={all} today={today} sel={sel} pick={pick} previews={previews} />
    </section>
  ));
  const panel = (
    <DayPanel
      key={d.date}
      d={d}
      live={d === today}
      now={now}
      previews={previews}
      medals={medals[d.pfid]}
    />
  );
  return (
    <div className="dp dp-cal-wrap" data-l={cell}>
      {cell === "D" && (
        <div className="dp-strip-wrap">
          <div className="dp-daystrip" ref={stripRef}>
            {[...all].reverse().map((x) => (
              <button
                key={x.date}
                className="dp-cell"
                aria-pressed={sel === x.date}
                data-today={x === today}
                onClick={() => pick(x.date)}
              >
                <Cell x={x} n={Number(x.date.slice(8))} cell="A" previews={previews} />
                <span className="dp-sm">{dayLabel(x, { month: "short" }).split(" ")[0]}</span>
              </button>
            ))}
          </div>
          <button className="dp-more" onClick={() => setCal(true)}>
            Calendar
          </button>
        </div>
      )}
      {cell === "E" && (
        <button className="dp-todaybar" onClick={() => pick(today.date)}>
          <i className="dp-live"></i>
          <span>
            Today: <b>{today.title}</b>
          </span>
          <span className="dp-dim">ends in {left(today.endsAt - now)}</span>
          <span className="dp-go">Open ›</span>
        </button>
      )}
      <div className="dp-cal-side" data-open={cal}>
        {cell === "D" && (
          <button className="dp-close" onClick={() => setCal(false)}>
            Close
          </button>
        )}
        {monthsBlock}
      </div>
      <div className="dp-cal-main" ref={panelRef} data-sheet={sheet}>
        {cell === "E" && (
          <button className="dp-close" onClick={() => setSheet(false)}>
            Close
          </button>
        )}
        {panel}
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
}: {
  d: Daily;
  live: boolean;
  now: number;
  previews: Previews;
  medals: Array<number> | undefined;
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
              <b>{fmtN(d.entries.length)}</b> players{live ? " so far" : ""}
            </span>
            {when}
          </span>
          <Link className="dp-alltime" href={mapHref(d.pfid)}>
            The Map&apos;s all-time board ›
          </Link>
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
