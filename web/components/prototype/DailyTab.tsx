"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 5 settled a player's Daily tab: the calendar of months (A) drawn with picture cells
// (E), and the streak tiles (C). The picker's buttons switch between a regular, a sometime
// and a one-off player.
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MapImage } from "../MapImage";
import { fmtN } from "../../lib/rules";
import { type Daily, dailiesFor } from "./daily-data";

type Previews = Record<string, string | null>;
interface Played {
  d: Daily;
  rank: number;
  field: number;
}

const PLAYERS = [
  ["76561198047392190", "Slati Jnr, 45"],
  ["76561198028751488", "Low5ive, 12"],
  ["76561199091867403", "Beanz, 4"],
] as const;

const band = (p: Played) =>
  p.rank === 1 ? "1" : p.rank <= 3 ? "pod" : p.rank <= 10 ? "t10" : "in";
const dayHref = (d: Daily) => `/daily?date=${d.date}`;

/* the longest run of Dailies played on consecutive days, and the run going now (today's
   Daily still counts as part of it while it is open and not yet played) */
function streaks(played: Array<Played>, all: Array<Daily>) {
  const set = new Set(played.map((p) => p.d.date));
  let best = 0,
    run = 0;
  for (const d of all) {
    run = set.has(d.date) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let now = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (set.has(all[i].date)) now++;
    else if (i < all.length - 1) break;
  }
  return { best, now };
}

function Tiles({ played, all }: { played: Array<Played>; all: Array<Daily> }) {
  const wins = played.filter((p) => p.rank === 1).length;
  const pods = played.filter((p) => p.rank <= 3).length;
  const s = streaks(played, all);
  return (
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
          {s.best}
          <small> longest{s.now ? `, ${s.now} now` : ""}</small>
        </dd>
      </div>
    </dl>
  );
}

function Months({
  played,
  all,
  previews,
}: {
  played: Array<Played>;
  all: Array<Daily>;
  previews: Previews;
}) {
  const by = new Map(played.map((p) => [p.d.date, p]));
  const months = [...new Set(all.map((x) => x.date.slice(0, 7)))].sort().reverse();
  return (
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
                const d = all.find((x) => x.date === date);
                const p = by.get(date);
                if (!d)
                  return (
                    <span key={date} className="dp-cell dp-none">
                      {i + 1}
                    </span>
                  );
                return (
                  <Link
                    key={date}
                    className="dp-cell dt-pc"
                    href={dayHref(d)}
                    data-b={p ? band(p) : "miss"}
                    title={`${d.title}${p ? ` · ${p.rank} of ${p.field}` : " · not played"}`}
                  >
                    <MapImage preview={previews[d.pfid]} />
                    <span className="dp-n">{i + 1}</span>
                    {p && <span className="dt-place">{p.rank === 1 ? "1st" : p.rank}</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function DailyTabPrototype({ id, previews }: { id: string; previews: Previews }) {
  const router = useRouter();
  const { today, past } = dailiesFor("quiet");
  const all = [...past].reverse().concat(today);
  const played: Array<Played> = [];
  for (const d of all) {
    const e = d.entries.find((x) => x[1] === id);
    if (e) played.push({ d, rank: e[0], field: d.entries.length });
  }
  return (
    <div className="dt">
      {played.length ? (
        <>
          <Tiles played={played} all={all} />
          <div className="dt-legend">
            <span data-b="1">1st</span>
            <span data-b="pod">Podium</span>
            <span data-b="t10">Top 10</span>
            <span data-b="in">Played</span>
          </div>
          <Months played={played} all={all} previews={previews} />
        </>
      ) : (
        <p className="dt-line">No Daily times yet.</p>
      )}
      <div className="proto-picker">
        <div className="pp-row">
          <b>Round 5, settled</b>
        </div>
        <p>Calendar with picture cells and streaks. Switch player:</p>
        <div className="pp-row">
          {PLAYERS.map(([pid, label]) => (
            <button
              key={pid}
              aria-pressed={pid === id}
              onClick={() => router.push(`/player/${pid}/daily`)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
