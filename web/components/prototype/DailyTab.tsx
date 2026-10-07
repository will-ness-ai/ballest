"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 5: a player's Dailies on their page, as a Daily tab. ?variant= picks the variant;
// the picker's buttons switch between a regular, a sometime and a one-off player.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MapImage } from "../MapImage";
import { fmtN, fmtTime, pctOf, shortGap } from "../../lib/rules";
import { type Daily, dailiesFor, dayLabel } from "./daily-data";

type Previews = Record<string, string | null>;
interface Played {
  d: Daily;
  rank: number;
  score: number;
  field: number;
  lead: number;
}

const VARIANTS = [
  [
    "A",
    "Calendar",
    "The Daily page's months, with each day the player played coloured by how they did (1st, podium, top 10, played) and missed days blank; a line of totals above. A day opens it on the Daily page.",
  ],
  [
    "B",
    "Results list",
    "Like the Workshop tab: a row per Daily played, newest first, with the map, place out of how many, time and gap to 1st.",
  ],
  [
    "C",
    "Totals + streaks",
    "Tiles for Dailies played, wins, podiums, best place and the longest run of days in a row, then a short list of their best Dailies.",
  ],
  [
    "D",
    "Form chart",
    "A bar per day since the first Daily, its height how high they placed (percentile), so form reads at a glance; the list under it.",
  ],
  [
    "E",
    "Picture cells",
    "Only the days they played, as the Daily page's picture cells, with their place on each.",
  ],
] as const;
type VKey = (typeof VARIANTS)[number][0];

const PLAYERS = [
  ["76561198047392190", "Slati Jnr, 45"],
  ["76561198028751488", "Low5ive, 12"],
  ["76561199091867403", "Beanz, 4"],
] as const;

const band = (p: Played) =>
  p.rank === 1 ? "1" : p.rank <= 3 ? "pod" : p.rank <= 10 ? "t10" : "in";
const dayHref = (d: Daily) => `/daily?date=${d.date}`;

function Totals({ played, all }: { played: Array<Played>; all: number }) {
  const wins = played.filter((p) => p.rank === 1).length;
  const pods = played.filter((p) => p.rank <= 3).length;
  const best = played.length ? Math.min(...played.map((p) => p.rank)) : null;
  return (
    <p className="dt-line">
      <b>{fmtN(played.length)}</b> of {fmtN(all)} Dailies · <b>{wins}</b> won · <b>{pods}</b> on the
      podium{best ? <> · best {best === 1 ? "1st" : "#" + best}</> : null}
    </p>
  );
}

function List({ played, limit }: { played: Array<Played>; limit?: number }) {
  const rows = limit ? played.slice(0, limit) : played;
  return (
    <div className="dt-list">
      {rows.map((p) => (
        <Link key={p.d.date} className="dt-row" href={dayHref(p.d)} data-b={band(p)}>
          <span className="dt-date">{dayLabel(p.d)}</span>
          <span className="dt-t">
            {p.d.title}
            <span className="dp-dim">
              {p.rank === 1 ? "Won the day" : shortGap(p.score - p.lead) + " behind 1st"}
            </span>
          </span>
          <span className="dt-rank">
            <b>{p.rank}</b>
            <span className="dp-dim">/{fmtN(p.field)}</span>
          </span>
          <span className="num dt-time">{fmtTime(p.score)}</span>
        </Link>
      ))}
    </div>
  );
}

function longestStreak(played: Array<Played>, all: Array<Daily>) {
  const set = new Set(played.map((p) => p.d.date));
  let best = 0,
    run = 0;
  for (const d of all) {
    run = set.has(d.date) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function VA({ played, all }: VP) {
  const by = new Map(played.map((p) => [p.d.date, p]));
  const months = [...new Set(all.map((x) => x.date.slice(0, 7)))].sort().reverse();
  return (
    <>
      <Totals played={played} all={all.length} />
      <div className="dt-legend">
        <span data-b="1">1st</span>
        <span data-b="pod">Podium</span>
        <span data-b="t10">Top 10</span>
        <span data-b="in">Played</span>
      </div>
      <div className="dt-months">
        {months.map((mo) => {
          const [y, m] = mo.split("-").map(Number);
          const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
          const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return (
            <section key={mo}>
              <h3 className="dp-h">
                {new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
                  month: "long",
                  timeZone: "UTC",
                })}
              </h3>
              <div className="dp-grid dt-grid">
                {Array.from({ length: first }, (_, i) => (
                  <span key={"b" + i}></span>
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const date = `${mo}-${String(i + 1).padStart(2, "0")}`;
                  const d = all.find((x) => x.date === date);
                  const p = by.get(date);
                  if (!d) return <span key={date} className="dt-c dt-off"></span>;
                  return (
                    <Link
                      key={date}
                      className="dt-c"
                      href={dayHref(d)}
                      data-b={p ? band(p) : "miss"}
                      title={d.title}
                    >
                      {p ? p.rank : ""}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function VB({ played, all }: VP) {
  return (
    <>
      <Totals played={played} all={all.length} />
      <List played={played} />
    </>
  );
}

function VC({ played, all }: VP) {
  const wins = played.filter((p) => p.rank === 1).length;
  const pods = played.filter((p) => p.rank <= 3).length;
  const best = played.length ? Math.min(...played.map((p) => p.rank)) : null;
  const top = [...played].sort((a, b) => a.rank / a.field - b.rank / b.field).slice(0, 5);
  return (
    <>
      <dl className="dp-tiles">
        <div>
          <dt>Dailies played</dt>
          <dd>
            {fmtN(played.length)}
            <small> of {all.length}</small>
          </dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd>{wins}</dd>
        </div>
        <div>
          <dt>Podiums</dt>
          <dd>{pods}</dd>
        </div>
        <div>
          <dt>Days in a row</dt>
          <dd>
            {longestStreak(played, all)}
            <small> longest</small>
          </dd>
        </div>
      </dl>
      <p className="dt-line">
        Best place {best ?? "-"}. Their best Dailies, by how far up the field they finished:
      </p>
      <List played={top} />
      <Link className="dp-alltime" href="#">
        All {fmtN(played.length)} Dailies ›
      </Link>
    </>
  );
}

function VD({ played, all }: VP) {
  const by = new Map(played.map((p) => [p.d.date, p]));
  return (
    <>
      <Totals played={played} all={all.length} />
      <div className="dt-chart" role="img" aria-label="Placing on each Daily">
        {all.map((d) => {
          const p = by.get(d.date);
          const h = p ? Math.max(6, Math.round((1 - (p.rank - 1) / p.field) * 100)) : 0;
          return (
            <Link
              key={d.date}
              href={dayHref(d)}
              title={`${dayLabel(d)} · ${d.title}${p ? ` · ${p.rank}/${p.field}` : " · not played"}`}
              data-b={p ? band(p) : "miss"}
            >
              <i style={{ height: h + "%" }}></i>
            </Link>
          );
        })}
      </div>
      <div className="dt-axis">
        <span>{dayLabel(all[0])}</span>
        <span>{dayLabel(all[all.length - 1])}</span>
      </div>
      <List played={played} />
    </>
  );
}

function VE({ played, all, previews }: VP) {
  return (
    <>
      <Totals played={played} all={all.length} />
      <div className="dt-cells">
        {played.map((p) => (
          <Link key={p.d.date} className="dp-cell dt-pc" href={dayHref(p.d)} data-b={band(p)}>
            <MapImage preview={previews[p.d.pfid]} />
            <span className="dp-n">{dayLabel(p.d)}</span>
            <span className="dt-place">
              {p.rank === 1 ? "1st" : "#" + p.rank}
              <small>{pctOf(p.rank, p.field)}</small>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

interface VP {
  played: Array<Played>;
  all: Array<Daily>;
  previews: Previews;
}
const VIEWS: Record<VKey, (p: VP) => React.ReactNode> = { A: VA, B: VB, C: VC, D: VD, E: VE };

export function DailyTabPrototype({ id, previews }: { id: string; previews: Previews }) {
  const sp = useSearchParams();
  const router = useRouter();
  const init = (sp.get("variant") ?? "A").toUpperCase();
  const [v, setV] = useState<VKey>(VARIANTS.some((x) => x[0] === init) ? (init as VKey) : "A");
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("variant", v);
    window.history.replaceState(window.history.state, "", u);
  }, [v]);
  const { today, past } = dailiesFor("quiet");
  const all = [...past].reverse().concat(today);
  const played: Array<Played> = [];
  for (const d of [...all].reverse()) {
    const e = d.entries.find((x) => x[1] === id);
    if (e)
      played.push({ d, rank: e[0], score: e[3], field: d.entries.length, lead: d.entries[0][3] });
  }
  const View = VIEWS[v];
  const i = VARIANTS.findIndex((x) => x[0] === v);
  const step = (n: number) => setV(VARIANTS[(i + n + VARIANTS.length) % VARIANTS.length][0]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="dt">
      {played.length ? (
        <View played={played} all={all} previews={previews} />
      ) : (
        <p className="dt-line">No Daily times yet.</p>
      )}
      <div ref={box} className="proto-picker">
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
          {PLAYERS.map(([pid, label]) => (
            <button
              key={pid}
              aria-pressed={pid === id}
              onClick={() => router.push(`/player/${pid}/daily?variant=${v}`)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
