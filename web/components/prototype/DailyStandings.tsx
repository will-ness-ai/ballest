"use client";
// PROTOTYPE (grill-design, Daily challenge). Not production code: never merged.
// Round 6 settled the all-time Daily standings at /daily/standings: record cards, each
// only the board's three plates, drawn small (E), then a sortable medal table of every player (B).
import Link from "next/link";
import { useState } from "react";

import { Plates } from "../board/BoardTop";
import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { fmtN, hueFor } from "../../lib/rules";
import { type Daily, dailiesFor, dayLabel } from "./daily-data";

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

type SortKey = "gold" | "silver" | "bronze" | "podiums" | "top10" | "played";
const SORTS: Array<[SortKey, string, (s: S) => number]> = [
  ["gold", "1st", (s) => exact(s, 1)],
  ["silver", "2nd", (s) => exact(s, 2)],
  ["bronze", "3rd", (s) => exact(s, 3)],
  ["podiums", "Podiums", (s) => count(s, 3)],
  ["top10", "Top 10", (s) => count(s, 10)],
  ["played", "Played", (s) => s.places.length],
];
/* the medal table: golds, then silvers, then bronzes, unless a column header picks another
   order; ties under any order fall back to the medal order */
function MedalTable({ list }: { list: Array<S> }) {
  const [by, setBy] = useState<SortKey>("gold");
  const [all, setAll] = useState(false);
  const f = SORTS.find((x) => x[0] === by)![2];
  const medal = (a: S, b: S) =>
    exact(b, 1) - exact(a, 1) ||
    exact(b, 2) - exact(a, 2) ||
    exact(b, 3) - exact(a, 3) ||
    b.places.length - a.places.length;
  const rows = [...list]
    .filter((s) => (by === "played" || by === "top10" ? f(s) > 0 : count(s, 3) > 0))
    .sort((a, b) => f(b) - f(a) || medal(a, b));
  const shown = all ? rows : rows.slice(0, 25);
  return (
    <section className="ds-table">
      <h2 className="dp-h">Every player</h2>
      <div className="board dp-st ds-medals">
        <div className="ds-mhead" role="row">
          <span></span>
          <span>Player</span>
          {SORTS.map(([k, label]) => (
            <button
              key={k}
              data-medal={k}
              aria-sort={by === k ? "descending" : undefined}
              onClick={() => setBy(k)}
            >
              {label}
              {by === k ? " ▾" : ""}
            </button>
          ))}
        </div>
        {shown.map((s, i) => (
          <div
            key={s.id}
            className="ds-mrow"
            style={{ "--h": hueFor(s.id) } as React.CSSProperties}
          >
            <span className="c-rank">{i + 1}</span>
            <span className="ds-who">
              <Marble who={{ steamId: s.id, persona: s.persona }} />
              <PlayerLink id={s.id} text={s.persona} tab="daily" />
            </span>
            {SORTS.map(([k, , g]) => (
              <b key={k} data-medal={k} data-on={by === k}>
                {g(s) || ""}
              </b>
            ))}
          </div>
        ))}
      </div>
      {!all && rows.length > shown.length && (
        <button className="dp-alltime ds-more" onClick={() => setAll(true)}>
          Show all {fmtN(rows.length)} players
        </button>
      )}
    </section>
  );
}

function Records({ list, closed }: VP) {
  const cards: Array<[string, (s: S) => number, string, string]> = [
    ["Most wins", (s) => count(s, 1), "wins", "win"],
    ["Most podiums", (s) => count(s, 3), "podiums", "podium"],
    ["Most Dailies played", (s) => s.places.length, "played", "played"],
    ["Longest run of days played", (s) => run(s, closed, false), "days", "day"],
    ["Longest run of wins", (s) => run(s, closed, true), "in a row", "in a row"],
  ];
  return (
    <div className="ds-cards">
      {cards.map(([title, f, unit, one]) => {
        const top = [...list]
          .map((s) => [s, f(s)] as const)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        const lead = top[0]?.[1] ?? 0;
        return (
          <section key={title} className="ds-card">
            <h3 className="dp-h">{title}</h3>
            <Plates
              focus={null}
              top={top.slice(0, 3).map(([s, v], i) => ({
                who: { steamId: s.id, persona: s.persona, avatar: null },
                score: `${v} ${v === 1 ? one : unit}`,
                line:
                  i === 0
                    ? top[1]?.[1] === v
                      ? "tied for the lead"
                      : "holds the record"
                    : v === lead
                      ? "tied for the lead"
                      : `${lead - v} behind`,
              }))}
            />
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
  const { past } = dailiesFor("quiet");
  const closed = [...past].reverse();
  const list = collect(closed);
  return (
    <div className="dp ds">
      <DailySwitch on="standings" />
      <header className="ds-top">
        <h1>Daily standings</h1>
        <p className="dt-line">
          All {closed.length} closed Dailies since {dayLabel(closed[0])} · {fmtN(list.length)}{" "}
          players. Today&apos;s Daily joins when it closes.
        </p>
      </header>
      <Records list={list} closed={closed} />
      <MedalTable list={list} />
    </div>
  );
}
