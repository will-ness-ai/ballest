"use client";
// One Daily's panel: its date, the Map's title, how many players set a time, a countdown
// while it is live or "Final" with its close in the reader's time zone, a link to the
// Map's all-time board, the top three on podium steps over the dimmed picture, then the
// rest of the board with each time's Medal. Live or final is the reader's clock against
// the close (isLive), so a page cached before the close flips at it without a fresh read.
import Link from "next/link";
import { Fragment, useState } from "react";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { Medal } from "../Medal";
import { PlayerLink } from "../PlayerLink";
import { RaceDrawer, useRaceOpen } from "../board/RaceDrawer";
import { RaceTime } from "../board/RaceTime";
import { ScoreRow } from "../board/ScoreRow";
import { useDailyClock } from "../../hooks/client";
import { dayLabel, timeLeft } from "../../lib/daily";
import { mapHref } from "../../lib/routes";
import type { BoardRow, DailyDay } from "../../lib/rows";
import { fmtN, fmtTime, hueFor, personaOf, timeMedal } from "../../lib/rules";

/* rows under the podium before "Show all" */
const SHOWN = 17;

const clockTime = (iso: string, withDay: boolean) =>
  new Date(iso).toLocaleString("en-US", {
    month: withDay ? "short" : undefined,
    day: withDay ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });

/* the countdown, or Final with the close; the reader's own time only once the page runs */
function When({ d, live, now }: { d: DailyDay; live: boolean; now: number | null }) {
  if (live)
    return (
      <span className="dp-clock">
        <i className="dp-live"></i>
        {now == null ? (
          "Live"
        ) : (
          <>
            Ends in <b>{timeLeft(Date.parse(d.endsAt) - now)}</b> · {clockTime(d.endsAt, false)}{" "}
            your time
          </>
        )}
      </span>
    );
  return (
    <span className="dp-clock">
      Final{now == null ? "" : ` · closed ${clockTime(d.endsAt, true)} your time`}
    </span>
  );
}

/* 2nd, 1st, 3rd, as podium steps stand; an empty step where nobody stands yet */
function Steps({
  top,
  live,
  open,
  onRace,
}: {
  top: ReadonlyArray<BoardRow>;
  live: boolean;
  open: string | null;
  onRace: (steamId: string) => void;
}) {
  return (
    <ol className="dp-steps">
      {[top.at(1), top.at(0), top.at(2)].map((r, i) =>
        r ? (
          <li
            key={r.steamId}
            data-m={r.rank}
            style={{ "--h": hueFor(r.steamId) } as React.CSSProperties}
          >
            <Marble who={r} />
            <span className="dp-wn">
              <PlayerLink id={r.steamId} text={personaOf(r)} />
            </span>
            <RaceTime
              steamId={r.steamId}
              who={personaOf(r)}
              score={fmtTime(r.score)}
              className="num"
              open={open === r.steamId}
              onRace={r.race ? onRace : undefined}
            />
            {r.rank === 1 && <span className="dp-lead">{live ? "Leading" : "Won the day"}</span>}
            <b>{r.rank}</b>
          </li>
        ) : (
          <li key={"empty" + String(i)} data-m={i === 1 ? 1 : i === 0 ? 2 : 3} data-empty="">
            <b>{i === 1 ? 1 : i === 0 ? 2 : 3}</b>
          </li>
        ),
      )}
    </ol>
  );
}

export function DayPanel({ d, rows }: { d: DailyDay; rows: ReadonlyArray<BoardRow> }) {
  /* the countdown moves on each minute, and Final shows at the close itself */
  const { now, live } = useDailyClock(d);
  const [all, setAll] = useState(false);
  const race = useRaceOpen(d.board, "list");
  const podium = useRaceOpen(d.board, "podium");
  const rest = rows.slice(3);
  const shown = all ? rest : rest.slice(0, SHOWN);
  const lead = rows.at(0)?.score ?? 0;
  const mark = (r: BoardRow) =>
    d.medals.length ? <Medal t={timeMedal(d.medals, r.score)} size={14} mini /> : undefined;
  return (
    <>
      <section className="dp-podium">
        <span className="dp-podbg">
          <MapImage preview={d.preview} />
        </span>
        <div className="dp-podhead">
          <span className="eyebrow">
            {live ? "Today's Daily · " + dayLabel(d.date) : "Daily · " + dayLabel(d.date, true)}
          </span>
          <h1>{d.title}</h1>
          <span className="dp-facts">
            <span>
              <b>{fmtN(d.entryCount)}</b> {d.entryCount === 1 ? "player" : "players"}
              {live ? " so far" : ""}
            </span>
            <When d={d} live={live} now={now} />
          </span>
          {d.listed && (
            <Link className="dp-alltime" href={mapHref(d.pfid)}>
              The Map&apos;s all-time board ›
            </Link>
          )}
        </div>
        {rows.length ? (
          <Steps top={rows.slice(0, 3)} live={live} open={podium.open} onRace={podium.toggle} />
        ) : (
          <p className="dp-none">
            {live ? "Nobody has set a time yet." : "Nobody set a time on this Daily."}
          </p>
        )}
      </section>
      {podium.open && <RaceDrawer key={podium.open} board={d.board} steamId={podium.open} podium />}
      {rest.length > 0 && (
        <div className="board" id="board">
          <div className="head">
            <span>#</span>
            <span></span>
            <span>Player</span>
            <span className="c-score">Time</span>
          </div>
          {shown.map((r) => (
            <Fragment key={r.steamId}>
              <ScoreRow
                r={r}
                lead={lead}
                points={false}
                pods={null}
                focus={false}
                leads={live ? "Leading" : "Won the day"}
                mark={mark(r)}
                open={race.open === r.steamId}
                onRace={race.toggle}
              />
              {race.open === r.steamId && <RaceDrawer board={d.board} steamId={r.steamId} />}
            </Fragment>
          ))}
        </div>
      )}
      {rest.length > SHOWN && (
        <button
          type="button"
          className="dp-more"
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? `Show the top ${String(SHOWN + 3)}` : `Show all ${fmtN(rows.length)} times`}
        </button>
      )}
    </>
  );
}
