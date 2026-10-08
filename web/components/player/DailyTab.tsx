// A player's Daily tab: four tiles (Dailies played of all, won, podiums, days in a row),
// then every Daily's month with each day they played bordered in the band of their place
// (1st, podium, top 10, played) and showing it, the days they missed dimmed. A day links to
// that Daily's page. Wins and podiums count final Dailies only, as the standings do, so
// today's live Daily shows the player's place in the plain played band.
import { Months } from "../daily/DayPicker";
import type { DailyCell, PlayerDailies } from "../../lib/rows";
import { fmtN } from "../../lib/rules";

const LEGEND = [
  ["1", "1st"],
  ["pod", "Podium"],
  ["t10", "Top 10"],
  ["in", "Played"],
] as const;

export function DailyTab({ mine, days }: { mine: PlayerDailies; days: ReadonlyArray<DailyCell> }) {
  const { played } = mine;
  if (!played.length) return <p className="dt-none">No Daily times yet.</p>;
  const { won, podiums } = mine;
  return (
    <>
      <dl className="pstats">
        <div className="pstat">
          <dt>Dailies played</dt>
          <dd>
            {fmtN(played.length) + " "}
            <small>{`of ${fmtN(days.length)}`}</small>
          </dd>
        </div>{" "}
        <div className="pstat">
          <dt>Won</dt>
          <dd>
            {fmtN(won) + " "}
            <small>{won ? "finished 1st" : "not yet"}</small>
          </dd>
        </div>{" "}
        <div className="pstat">
          <dt>Podiums</dt>
          <dd>
            {fmtN(podiums) + " "}
            <small>top three</small>
          </dd>
        </div>{" "}
        <div className="pstat">
          <dt>Days in a row</dt>
          <dd>
            {fmtN(mine.longest) + " "}
            <small>{"longest" + (mine.current ? `, ${fmtN(mine.current)} now` : "")}</small>
          </dd>
        </div>
      </dl>{" "}
      <div className="dt-legend" aria-hidden="true">
        {LEGEND.map(([b, label]) => (
          <span key={b} data-b={b}>
            {label}
          </span>
        ))}
      </div>{" "}
      <div className="dt-months">
        <Months days={days} mine={Object.fromEntries(played.map((p) => [p.date, p]))} />
      </div>
    </>
  );
}
