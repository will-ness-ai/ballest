"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 1: where Dailies live and what leads. Five variants on /daily, picked by
// ?variant=, with ?state= switching between a quiet and a busy today.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { mapHref } from "../../lib/routes";
import { fmtN, fmtTime, hueFor, shortGap } from "../../lib/rules";
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
    "Today first",
    "A Daily page: today's map, countdown and live board, then every past Daily as a list.",
  ],
  [
    "B",
    "Calendar",
    "A Daily page laid out as a month calendar; pick a day to open its board beside it.",
  ],
  [
    "C",
    "On the Map's page",
    "No Daily page: a banner for today's Daily on the homepage, and a Daily tab on the Map's own page. (The Daily tab in the header stays for this round.)",
  ],
  [
    "D",
    "Standings first",
    "A Daily page led by who wins Dailies most: a compact today strip, then the all-time Daily standings.",
  ],
  [
    "E",
    "Feed",
    "A Daily page as a feed of day cards, each with its podium; today's card is the big one.",
  ],
] as const;
type VKey = (typeof VARIANTS)[number][0];

/* ---------- shared pieces ---------- */

function DRow({ e, lead, prev }: { e: DEntry; lead: number; prev: number | null }) {
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
            "Won the day"
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
        <i className="pill"></i>
      </span>
    </div>
  );
}

function DBoard({ d, limit = 10 }: { d: Daily; limit?: number; live?: boolean }) {
  const [all, setAll] = useState(false);
  const rows = all ? d.entries : d.entries.slice(0, limit);
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
          <DRow key={e[1]} e={e} lead={lead} prev={i ? rows[i - 1][3] : null} />
        ))}
      </div>
      {d.entries.length > limit && (
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

/* ---------- A · Today first ---------- */
function VA({ today, past, now, previews }: VProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="dp">
      <Hero d={today} now={now} previews={previews} />
      <h2 className="dp-h">Today's board</h2>
      <DBoard d={today} live />
      <h2 className="dp-h">Past Dailies</h2>
      <div className="dp-list">
        {past.map((d) => (
          <div key={d.date} className="dp-item">
            <button
              className="dp-li"
              onClick={() => setOpen(open === d.date ? null : d.date)}
              aria-expanded={open === d.date}
            >
              <span className="dp-date">{dayLabel(d)}</span>
              <MapImage preview={previews[d.pfid]} frame />
              <span className="dp-t">
                {d.title}
                <span className="dp-dim">{fmtN(d.entries.length)} players</span>
              </span>
              <Winner d={d} />
            </button>
            {open === d.date && (
              <div className="dp-open">
                <DBoard d={d} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- B · Calendar ---------- */
function VB({ today, past, now, previews }: VProps) {
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
                      aria-pressed={sel === date}
                      data-today={x === today}
                      onClick={() => setSel(date)}
                    >
                      <MapImage preview={previews[x.pfid]} />
                      <span className="dp-n">{i + 1}</span>
                      {w && <Marble who={{ steamId: w[1], persona: w[2] }} />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="dp-cal-main">
        {d === today ? (
          <Hero d={d} now={now} previews={previews} big={false} />
        ) : (
          <section className="dp-hero dp-hero-s">
            <span className="dp-pic">
              <MapImage preview={previews[d.pfid]} />
            </span>
            <div className="dp-hero-t">
              <span className="eyebrow">
                Daily · {dayLabel(d, { weekday: "short", year: "numeric" })}
              </span>
              <h1>{d.title}</h1>
              <span className="dp-facts">
                <span>
                  <b>{fmtN(d.entries.length)}</b> players
                </span>
              </span>
              <span className="dp-links">
                <Link href={mapHref(d.pfid)}>The Map's all-time board</Link>
              </span>
            </div>
          </section>
        )}
        <DBoard key={d.date} d={d} limit={15} />
      </div>
    </div>
  );
}

/* ---------- C · On the Map's page ---------- */
function VC({ today, past, now, previews }: VProps) {
  const [tab, setTab] = useState<"daily" | "all">("daily");
  return (
    <div className="dp">
      <p className="dp-note">How the homepage's top would look:</p>
      <Link className="dp-banner" href="#">
        <i className="dp-live"></i>
        <span>
          Today's Daily: <b>{today.title}</b>
        </span>
        <span className="dp-dim">
          {fmtN(today.entries.length)} players · ends in {left(today.endsAt - now)}
        </span>
        <span className="dp-go">Play the board →</span>
      </Link>
      <p className="dp-note">And the Map's page it opens:</p>
      <div className="dp-mapmock">
        <aside className="mpanel">
          <MapImage preview={previews[today.pfid]} className="mp-img" />
          <h1 className="mp-t">{today.title}</h1>
          <div className="dp-was">
            <span className="eyebrow">Daily on</span>
            <span>{dayLabel(today, { weekday: "short" })} (today)</span>
          </div>
        </aside>
        <div>
          <div className="dp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "daily"} onClick={() => setTab("daily")}>
              Daily · {dayLabel(today)}
            </button>
            <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
              All time
            </button>
          </div>
          {tab === "daily" ? (
            <>
              <p className="dp-sub">
                <Countdown d={today} now={now} />
              </p>
              <DBoard d={today} limit={15} live />
            </>
          ) : (
            <p className="dp-note">
              The Map's own board, exactly as its page shows it now.{" "}
              <Link href={mapHref(today.pfid)}>Open it</Link>
            </p>
          )}
        </div>
      </div>
      <p className="dp-note">
        Past Dailies would only be reachable from each Map's page ({past.length} so far), or a
        player's page.
      </p>
    </div>
  );
}

/* ---------- D · Standings first ---------- */
function VD({ today, past, now, previews }: VProps) {
  const st = standings(past).slice(0, 50);
  return (
    <div className="dp">
      <Link className="dp-strip" href="#today">
        <MapImage preview={previews[today.pfid]} frame />
        <span className="dp-t">
          <span className="eyebrow">Today's Daily</span>
          {today.title}
        </span>
        <Countdown d={today} now={now} />
        <Winner d={today} />
      </Link>
      <h2 className="dp-h">
        Daily standings <span className="dp-dim">over {past.length} closed Dailies</span>
      </h2>
      <div className="dp-table">
        <div className="dp-tr dp-th">
          <span>#</span>
          <span></span>
          <span>Player</span>
          <span>Wins</span>
          <span>Podiums</span>
          <span>Top 10</span>
          <span>Played</span>
        </div>
        {st.map((s, i) => (
          <div key={s.steamId} className="dp-tr" data-m={i < 3 ? i + 1 : 0}>
            <span className="c-rank">{i + 1}</span>
            <Marble who={s} />
            <span className="nm">
              <PlayerLink id={s.steamId} text={s.persona} />
            </span>
            <span className="num">
              <b>{s.wins}</b>
            </span>
            <span className="num">{s.podiums}</span>
            <span className="num">{s.top10}</span>
            <span className="num">{s.played}</span>
          </div>
        ))}
      </div>
      <h2 className="dp-h" id="today">
        Today's board
      </h2>
      <DBoard d={today} live />
    </div>
  );
}

/* ---------- E · Feed ---------- */
function VE({ today, past, now, previews }: VProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="dp">
      <section className="dp-feed-today">
        <Hero d={today} now={now} previews={previews} />
        <DBoard d={today} limit={5} live />
      </section>
      <div className="dp-feed">
        {past.map((d) => (
          <article key={d.date} className="dp-card" data-open={open === d.date}>
            <button className="dp-card-h" onClick={() => setOpen(open === d.date ? null : d.date)}>
              <span className="im">
                <MapImage preview={previews[d.pfid]} />
              </span>
              <span className="dp-card-t">
                <span className="eyebrow">{dayLabel(d, { weekday: "short" })}</span>
                <b>{d.title}</b>
                <span className="dp-dim">{fmtN(d.entries.length)} players</span>
              </span>
            </button>
            <ol className="dp-pod">
              {d.entries.slice(0, 3).map((e) => (
                <li key={e[1]} data-m={e[0]}>
                  <b>{e[0]}</b>
                  <Marble who={{ steamId: e[1], persona: e[2] }} />
                  <span className="dp-wn">{e[2]}</span>
                  <span className="num">{fmtTime(e[3])}</span>
                </li>
              ))}
              {!d.entries.length && <li className="dp-dim">Nobody finished</li>}
            </ol>
            {open === d.date && <DBoard d={d} limit={20} />}
          </article>
        ))}
      </div>
    </div>
  );
}

interface VProps {
  today: Daily;
  past: Array<Daily>;
  now: number;
  previews: Previews;
}
const VIEWS: Record<VKey, (p: VProps) => React.ReactNode> = { A: VA, B: VB, C: VC, D: VD, E: VE };

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

export function DailyPrototype({ previews }: { previews: Previews }) {
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
      <View {...dailiesFor(state)} previews={previews} />
      <Picker v={v} setV={setV} state={state} setState={setState} />
    </>
  );
}
