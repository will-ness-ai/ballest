/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE (round 3): a player's Trials on the Official tab. The Towers come from the
// player's record (the local database); Leth Trial #1 from the Steam snapshot, since the
// local database has no Event boards.
import Link from "next/link";

import { V } from "./V";
import { TRIALS, type Trial } from "./trials-data";
import type { PlayerRecord } from "../../lib/player";
import { fmtN, fmtTime, ord, pctOf, shortGap } from "../../lib/rules";

export interface TrialRun {
  t: Trial;
  rank: number;
  field: number;
  score: number;
  lead: number;
}

export function trialRuns(rec: PlayerRecord): Array<TrialRun | { t: Trial; rank: null }> {
  const tiles = rec.seasons.find((s) => s.group === "Trials")?.tiers.flatMap((x) => x.tracks) ?? [];
  return TRIALS.map((t) => {
    const tile = tiles.find((x) => x.name === t.board);
    if (tile?.finish)
      return {
        t,
        rank: tile.finish.rank,
        field: tile.field,
        score: tile.finish.score,
        lead: tile.finish.lead,
      };
    const row = t.top.find((r) => r.steamId === rec.id);
    if (row) return { t, rank: row.rank, field: t.players, score: row.score, lead: t.top[0].score };
    return { t, rank: null };
  });
}

/* the Official tab's numbers with the Trials taken out of "Tracks run" and Leth's place added
   to the world records and podiums */
export function officialStats(rec: PlayerRecord) {
  const runs = trialRuns(rec);
  const towers = runs.filter((r) => r.t.board.startsWith("Map_TheTower"));
  const leth = runs.find((r) => !r.t.board.startsWith("Map_TheTower"));
  const medals = { ...rec.medals };
  const golds = [...rec.golds];
  if (leth?.rank && leth.rank <= 3) {
    medals[(["gold", "silver", "bronze"] as const)[leth.rank - 1]]++;
    if (leth.rank === 1) golds.push(leth.t.title);
  }
  return {
    medals,
    golds,
    run: rec.run - towers.filter((r) => r.rank).length,
    tracks: rec.tracks - towers.length,
    trialsRun: runs.filter((r) => r.rank).length,
    best: runs.filter((r): r is TrialRun => r.rank !== null).sort((a, b) => a.rank - b.rank)[0],
  };
}

function TrialTile({ r }: { r: ReturnType<typeof trialRuns>[number] }) {
  if (r.rank === null)
    return (
      <span className="ptile untimed">
        <span className="pt-name">{r.t.title}</span> <span className="pt-rank">&mdash;</span>
        <span className="pt-time">no time</span>
      </span>
    );
  const w = Math.max(0, Math.round((1 - (r.rank - 1) / r.field) * 100));
  return (
    <Link className="ptile" data-m={r.rank <= 3 ? r.rank : 0} href={r.t.href}>
      <span className="pt-name">{r.t.title}</span>{" "}
      <span className="pt-line">
        <span className="pt-rank">
          {r.rank}
          <sup>{ord(r.rank).slice(-2)}</sup>
          <span className="pt-of">{"/" + fmtN(r.field)}</span>
        </span>{" "}
        <span className="pt-gap">{r.rank === 1 ? "record" : shortGap(r.score - r.lead)}</span>
      </span>{" "}
      <span className="pt-time">{fmtTime(r.score)}</span>{" "}
      <span className="pt-pct">{pctOf(r.rank, r.field)}</span>{" "}
      <span className="pt-bar">
        <i style={{ "--w": String(w) + "%" } as React.CSSProperties}></i>
      </span>
    </Link>
  );
}

function Slab({ rec }: { rec: PlayerRecord }) {
  return (
    <div className="pslab">
      <h2>Trials</h2> <span className="pov">not in Overall points</span>
    </div>
  );
}

/* A and B: a Trials slab of tiles, like a season's, with no points */
export function TrialsTiles({ rec }: { rec: PlayerRecord }) {
  return (
    <section className="pseason pt-trials">
      <Slab rec={rec} />{" "}
      <div className="ptier">
        <span className="ptlab">
          {"Trials run"}
          <span className="ptsum">
            <b>{trialRuns(rec).filter((r) => r.rank !== null).length}</b> of 3
          </span>
        </span>{" "}
        <div className="pgrid">
          {trialRuns(rec).map((r) => (
            <TrialTile key={r.t.board} r={r} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* C: a card per Trial, picture on top, like /trials */
export function TrialsCards({ rec }: { rec: PlayerRecord }) {
  return (
    <section className="pseason pt-trials">
      <Slab rec={rec} />{" "}
      <nav className="tr-cards pt-cards" aria-label="Trials">
        {trialRuns(rec).map((r) => (
          <Link
            key={r.t.board}
            className="tr-card"
            href={r.t.href}
            data-m={r.rank && r.rank <= 3 ? r.rank : 0}
          >
            {r.t.picture ? (
              <img className="tr-cpic" src={r.t.picture} alt="" />
            ) : (
              <span className="tr-cpic tp-ph" aria-hidden>
                <span>Tower picture</span>
              </span>
            )}
            <span className="tr-cin">
              <b>{r.t.title}</b>
              <small>
                {r.rank === null
                  ? "no time"
                  : `${ord(r.rank)} of ${fmtN(r.field)} · ${fmtTime(r.score)}${r.rank === 1 ? " · record" : " · " + shortGap(r.score - r.lead)}`}
              </small>
            </span>
          </Link>
        ))}
      </nav>
    </section>
  );
}

/* D: plain rows, one line a Trial */
export function TrialsRows({ rec }: { rec: PlayerRecord }) {
  return (
    <section className="pseason pt-trials">
      <Slab rec={rec} />{" "}
      <ol className="pt-rows">
        {trialRuns(rec).map((r) => (
          <li key={r.t.board} data-m={r.rank && r.rank <= 3 ? r.rank : 0}>
            <Link href={r.t.href}>{r.t.title}</Link>
            <span className="pt-rank">{r.rank === null ? "—" : ord(r.rank)}</span>
            <span className="pt-of">{r.rank === null ? "" : "of " + fmtN(r.field)}</span>
            <span className="pt-time">{r.rank === null ? "no time" : fmtTime(r.score)}</span>
            <span className="pt-gap">
              {r.rank === null ? "" : r.rank === 1 ? "record" : shortGap(r.score - r.lead)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PlayerTrials({ rec, at }: { rec: PlayerRecord; at: "top" | "end" }) {
  return at === "top" ? (
    <V k="B">
      <TrialsTiles rec={rec} />
    </V>
  ) : (
    <>
      <V k="A">
        <TrialsTiles rec={rec} />
      </V>
      <V k="C">
        <TrialsCards rec={rec} />
      </V>
      <V k="D">
        <TrialsRows rec={rec} />
      </V>
    </>
  );
}
