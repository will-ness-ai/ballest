// The all-time Daily standings (/daily/standings), over final Dailies only: a card per
// record, each the record's top three as the board's plates drawn small, equal values
// sharing a place (standingsOf in lib/daily.ts), then every player's medal table
// (MedalTable). The live Daily joins them once it closes.
import { Plates } from "../board/Plates";
import { DailySwitch } from "./DailySwitch";
import { MedalTable } from "./MedalTable";
import { getDailyStandings } from "../../db/data";
import { dayLabel, recordLine } from "../../lib/daily";
import type { DailyRecordKey } from "../../lib/rows";
import { plural } from "../../lib/rules";

/* each record's title, and its value's noun */
const RECORD: Record<DailyRecordKey, [string, string, string]> = {
  wins: ["Most wins", "win", "wins"],
  podiums: ["Most podiums", "podium", "podiums"],
  played: ["Most Dailies played", "Daily", "Dailies"],
  playedRun: ["Longest run of days played", "day", "days"],
  winRun: ["Longest run of wins", "win", "wins in a row"],
};

export async function StandingsView() {
  const s = await getDailyStandings();
  return (
    <div className="main ds">
      <DailySwitch on="standings" />
      <section className="content ds-body">
        <header className="ds-top">
          <h1>Daily standings</h1>
          <p className="ds-line">
            {s.since
              ? `${plural(s.dailies, "final Daily", "final Dailies")} since ${dayLabel(s.since, true)} · ${plural(s.players.length, "player", "players")}. Today's Daily counts once it closes.`
              : "No Daily has closed yet."}
          </p>
        </header>
        {s.since && (
          <>
            <div className="ds-cards">
              {s.records.map((r) => {
                const [title, one, many] = RECORD[r.key];
                return (
                  <section key={r.key} className="ds-card" aria-label={title}>
                    <h2 className="ds-h">{title}</h2>
                    <Plates
                      size="small"
                      tab="daily"
                      top={r.holders.map((h, i) => ({
                        who: h,
                        score: plural(h.value, one, many),
                        line: recordLine(r, i),
                        place: h.place,
                      }))}
                    />
                  </section>
                );
              })}
            </div>
            <MedalTable players={s.players} />
          </>
        )}
      </section>
    </div>
  );
}
