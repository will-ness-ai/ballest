"use client";
// The Daily standings' medal table: every player with a Daily podium, sorted on whichever
// column the reader picks (medalTable in lib/daily.ts), 25 rows and then the rest on
// "Show all". Each header is a button, and its cell carries aria-sort, so the sort is
// reachable by keyboard and announced. A phone shows 1st, 2nd, 3rd and Played; Podiums
// and Top 10 are desktop columns (desktop.css).
import { useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { MEDAL_COLUMNS, medalTable, type MedalColumn } from "../../lib/daily";
import type { DailyStanding } from "../../lib/rows";
import { fmtN, personaOf } from "../../lib/rules";

const LABEL: Record<MedalColumn, string> = {
  gold: "1st",
  silver: "2nd",
  bronze: "3rd",
  podiums: "Podiums",
  top10: "Top 10",
  played: "Played",
};

const SHOWN = 25;

export function MedalTable({ players }: { players: ReadonlyArray<DailyStanding> }) {
  const [by, setBy] = useState<MedalColumn>("gold");
  const [all, setAll] = useState(false);
  const rows = medalTable(players, by);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section className="ds-table" aria-labelledby="ds-every">
      <h2 className="ds-h" id="ds-every">
        Every player
      </h2>
      <table className="ds-medals">
        <thead>
          <tr>
            <th scope="col" className="ds-r" aria-label="Place"></th>
            <th scope="col" className="ds-who">
              Player
            </th>
            {MEDAL_COLUMNS.map((k) => (
              <th
                key={k}
                scope="col"
                data-medal={k}
                aria-sort={by === k ? "descending" : undefined}
              >
                <button
                  type="button"
                  onClick={() => {
                    setBy(k);
                  }}
                >
                  {LABEL[k]}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(({ rank, s }) => (
            <tr key={s.steamId}>
              <td className="ds-r">{rank}</td>
              <td className="ds-who">
                <span>
                  <Marble who={s} />
                  <PlayerLink id={s.steamId} text={personaOf(s)} tab="daily" />
                </span>
              </td>
              {MEDAL_COLUMNS.map((k) => (
                <td key={k} data-medal={k} data-on={by === k || undefined}>
                  {s[k] || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!all && rows.length > SHOWN && (
        <button
          type="button"
          className="dp-more"
          onClick={() => {
            setAll(true);
          }}
        >
          Show all {fmtN(rows.length)} players
        </button>
      )}
    </section>
  );
}
