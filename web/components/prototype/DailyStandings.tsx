"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 6: all-time Daily standings at /daily/standings, over the closed Dailies in the
// fixture. ?variant= picks the variant.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { fmtN, hueFor } from "../../lib/rules";
import { type Daily, dailiesFor } from "./daily-data";

const VARIANTS = [
  ["A", "Wins", "Ranked by Dailies won, then podiums, then top 10s; each row says the rest."],
  [
    "B",
    "Medal table",
    "Gold, silver and bronze columns like an Olympic table: most golds first, then silvers, then bronzes.",
  ],
  [
    "C",
    "Points",
    "Every Daily hands out points to its top 10 (25, 18, 15, 12, 10, 8, 6, 4, 2, 1); ranked by the total.",
  ],
  [
    "D",
    "Average finish",
    "How high up the field a player finishes on average, for players with 10 Dailies or more; rewards turning up and doing well.",
  ],
  [
    "E",
    "Records",
    "No single table: a card per record (most wins, podiums, Dailies played, longest run of days played, longest run of wins), top five each.",
  ],
] as const;
type VKey = (typeof VARIANTS)[number][0];

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

interface S {
  id: string;
  persona: string;
  places: Array<number>; // rank per Daily played, oldest first
  dates: Array<string>;
  pct: number; // summed (1 - (rank-1)/field)
}

function collect(closed: Array<Daily>) {
  const by = new Map<string, S>();
  for (const d of closed)
    for (const [rank, id, persona] of d.entries) {
      const s = by.get(id) ?? { id, persona, places: [], dates: [], pct: 0 };
      s.places.push(rank);
      s.dates.push(d.date);
      s.pct += 1 - (rank - 1) / d.entries.length;
      by.set(id, s);
    }
  return [...by.values()];
}
const count = (s: S, n: number) => s.places.filter((r) => r <= n).length;
const exact = (s: S, n: number) => s.places.filter((r) => r === n).length;
const points = (s: S) => s.places.reduce((t, r) => t + (POINTS[r - 1] ?? 0), 0);
function run(s: S, closed: Array<Daily>, won: boolean) {
  const at = new Map(s.dates.map((d, i) => [d, s.places[i]]));
  let best = 0,
    cur = 0;
  for (const d of closed) {
    const r = at.get(d.date);
    cur = r !== undefined && (!won || r === 1) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

function Row({
  rank,
  s,
  sub,
  value,
  unit,
}: {
  rank: number;
  s: S;
  sub: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
}) {
  return (
    <div
      className="row"
      style={{ "--h": hueFor(s.id) } as React.CSSProperties}
      data-m={rank <= 3 ? rank : 0}
    >
      <span className="c-rank">{rank}</span>
      <Marble who={{ steamId: s.id, persona: s.persona }} />
      <span className="c-text">
        <span className="nm">
          <PlayerLink id={s.id} text={s.persona} tab="daily" />
        </span>
        <span className="sub">{sub}</span>
      </span>
      <span className="c-score">
        <span>{value}</span>
        {unit && <small className="dp-dim"> {unit}</small>}
      </span>
    </div>
  );
}

function Table({ rows, limit = 25 }: { rows: Array<React.ReactNode>; limit?: number }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="board dp-st">{all ? rows : rows.slice(0, limit)}</div>
      {!all && rows.length > limit && (
        <button className="dp-alltime ds-more" onClick={() => setAll(true)}>
          Show all {fmtN(rows.length)} players
        </button>
      )}
    </>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function VA({ list }: VP) {
  const rows = [...list]
    .filter((s) => count(s, 10) > 0)
    .sort(
      (a, b) =>
        count(b, 1) - count(a, 1) ||
        count(b, 3) - count(a, 3) ||
        count(b, 10) - count(a, 10) ||
        b.places.length - a.places.length,
    );
  return (
    <Table
      rows={rows.map((s, i) => (
        <Row
          key={s.id}
          rank={i + 1}
          s={s}
          sub={`${plural(count(s, 3), "podium")} · ${count(s, 10)} top 10 · ${s.places.length} played`}
          value={count(s, 1)}
          unit={count(s, 1) === 1 ? "win" : "wins"}
        />
      ))}
    />
  );
}

function VB({ list }: VP) {
  const rows = [...list]
    .filter((s) => count(s, 3) > 0)
    .sort(
      (a, b) =>
        exact(b, 1) - exact(a, 1) ||
        exact(b, 2) - exact(a, 2) ||
        exact(b, 3) - exact(a, 3) ||
        b.places.length - a.places.length,
    );
  return (
    <div className="board dp-st ds-medals">
      <div className="ds-mhead">
        <span></span>
        <span>Player</span>
        <i data-medal="gold">1st</i>
        <i data-medal="silver">2nd</i>
        <i data-medal="bronze">3rd</i>
        <span>Played</span>
      </div>
      {rows.map((s, i) => (
        <div key={s.id} className="ds-mrow" style={{ "--h": hueFor(s.id) } as React.CSSProperties}>
          <span className="c-rank">{i + 1}</span>
          <span className="ds-who">
            <Marble who={{ steamId: s.id, persona: s.persona }} />
            <PlayerLink id={s.id} text={s.persona} tab="daily" />
          </span>
          <b data-medal="gold">{exact(s, 1) || ""}</b>
          <b data-medal="silver">{exact(s, 2) || ""}</b>
          <b data-medal="bronze">{exact(s, 3) || ""}</b>
          <span className="dp-dim">{s.places.length}</span>
        </div>
      ))}
    </div>
  );
}

function VC({ list }: VP) {
  const rows = [...list]
    .filter((s) => points(s) > 0)
    .sort((a, b) => points(b) - points(a) || count(b, 1) - count(a, 1));
  return (
    <>
      <p className="dt-line">
        25, 18, 15, 12, 10, 8, 6, 4, 2 and 1 point for 1st to 10th on each Daily.
      </p>
      <Table
        rows={rows.map((s, i) => (
          <Row
            key={s.id}
            rank={i + 1}
            s={s}
            sub={`${plural(count(s, 1), "win")} · ${count(s, 10)} of ${s.places.length} Dailies in the top 10`}
            value={fmtN(points(s))}
            unit="pts"
          />
        ))}
      />
    </>
  );
}

function VD({ list }: VP) {
  const rows = [...list]
    .filter((s) => s.places.length >= 10)
    .sort((a, b) => b.pct / b.places.length - a.pct / a.places.length);
  return (
    <>
      <p className="dt-line">
        Players with 10 Dailies or more, by how far up the field they finish on average.
      </p>
      <Table
        rows={rows.map((s, i) => {
          const top = Math.max(1, Math.round((1 - s.pct / s.places.length) * 100));
          return (
            <Row
              key={s.id}
              rank={i + 1}
              s={s}
              sub={`${s.places.length} Dailies · best ${Math.min(...s.places) === 1 ? "1st" : "#" + Math.min(...s.places)}`}
              value={`Top ${top}%`}
            />
          );
        })}
      />
    </>
  );
}

function VE({ list, closed }: VP) {
  const cards: Array<[string, (s: S) => number, string]> = [
    ["Most wins", (s) => count(s, 1), "wins"],
    ["Most podiums", (s) => count(s, 3), "podiums"],
    ["Most Dailies played", (s) => s.places.length, "played"],
    ["Longest run of days played", (s) => run(s, closed, false), "days"],
    ["Longest run of wins", (s) => run(s, closed, true), "in a row"],
  ];
  return (
    <div className="ds-cards">
      {cards.map(([title, f, unit]) => {
        const top = [...list]
          .map((s) => [s, f(s)] as const)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        return (
          <section key={title}>
            <h3 className="dp-h">{title}</h3>
            <div className="board dp-st">
              {top.map(([s, v], i) => (
                <Row key={s.id} rank={i + 1} s={s} sub="" value={v} unit={unit} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface VP {
  list: Array<S>;
  closed: Array<Daily>;
}
const VIEWS: Record<VKey, (p: VP) => React.ReactNode> = { A: VA, B: VB, C: VC, D: VD, E: VE };

export function DailySwitch({ on }: { on: "days" | "standings" }) {
  return (
    <nav className="ds-switch" aria-label="Daily">
      <Link href="/daily" aria-current={on === "days" ? "page" : undefined}>
        Days
      </Link>
      <Link href="/daily/standings" aria-current={on === "standings" ? "page" : undefined}>
        Standings
      </Link>
    </nav>
  );
}

export function DailyStandingsPrototype() {
  const sp = useSearchParams();
  const init = (sp.get("variant") ?? "A").toUpperCase();
  const [v, setV] = useState<VKey>(VARIANTS.some((x) => x[0] === init) ? (init as VKey) : "A");
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("variant", v);
    window.history.replaceState(window.history.state, "", u);
  }, [v]);
  const i = VARIANTS.findIndex((x) => x[0] === v);
  const step = (n: number) => setV(VARIANTS[(i + n + VARIANTS.length) % VARIANTS.length][0]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const { past } = dailiesFor("quiet");
  const closed = [...past].reverse();
  const list = collect(closed);
  const View = VIEWS[v];
  return (
    <div className="dp ds">
      <DailySwitch on="standings" />
      <header className="ds-top">
        <h1>Daily standings</h1>
        <p className="dt-line">
          All {closed.length} closed Dailies since{" "}
          {new Date(closed[0].date + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}{" "}
          · {fmtN(list.length)} players. Today&apos;s Daily joins when it closes.
        </p>
      </header>
      <View list={list} closed={closed} />
      <div className="proto-picker">
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
      </div>
    </div>
  );
}
