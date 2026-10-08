// What a board shows above its list, drawn on the server from the board's first rows: the
// tiles, the three plates, the card across the top (a Track's screenshot and spread, or an
// Overall board's standings), and the switch between an Overall board's two orders.
// A Map's page uses the tiles-free parts: the plates and the list.
import Link from "next/link";

import { QMark } from "./PointsDialog";
import { Spread } from "./Spread";
import { Marble } from "../Marble";
import { MedalCounts } from "../MedalCounts";
import { PlayerLink } from "../PlayerLink";
import { TRACKS, trackNo } from "../../lib/circuit";
import type { IndexBoard } from "../../lib/player";
import { podiumTotal, type PodiumPlayer, type PodiumTally } from "../../lib/podiums";
import { PODIUM_SORT, boardHref } from "../../lib/routes";
import { fmtN, fmtTime, hueFor, isPoints, personaOf, value } from "../../lib/rules";
import type { BoardRow } from "../../lib/rows";

const PLACE = ["1st", "2nd", "3rd"];

/* a card's facts, each a label over its value */
function Facts({ facts }: { facts: ReadonlyArray<[string, React.ReactNode]> }) {
  return (
    <dl className="bc-facts">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tiles({
  name,
  rows,
  count,
}: {
  name: string;
  rows: Array<BoardRow>;
  count: number;
}) {
  if (!rows.length) return <dl className="tiles" id="tiles"></dl>;
  const points = isPoints(name);
  const lead = rows[0],
    tenth = rows[Math.min(9, rows.length - 1)];
  const spread = points
    ? fmtN(lead.score - tenth.score) + " pts"
    : fmtTime(tenth.score - lead.score);
  return (
    <dl className="tiles" id="tiles">
      <div className="tile">
        <dt>Leader</dt>
        <dd>
          {value(name, lead.score)}{" "}
          <span className="tsub">
            <Marble who={lead} />
            <span>{personaOf(lead)}</span>
          </span>
        </dd>
      </div>
      <div className="tile">
        <dt>Field</dt>
        <dd>
          {fmtN(count)}{" "}
          <span className="tsub">
            <span>{points ? "players ranked" : "runs recorded"}</span>
          </span>
        </dd>
      </div>
      <div className="tile">
        <dt>Top ten spread</dt>
        <dd>
          {spread}{" "}
          <span className="tsub">
            <span>1st to {Math.min(10, count)}th</span>
          </span>
        </dd>
      </div>
    </dl>
  );
}

/* the marble row: three plates, each a player, what they scored, and a line under it */
/* PROTOTYPE (grill-design, Daily challenge): exported for the Daily standings */
export function Plates({
  top,
  focus,
}: {
  top: Array<{
    who: { steamId: string; persona: string; avatar: string | null };
    score: React.ReactNode;
    line: string;
  }>;
  focus: string | null;
}) {
  if (top.length < 3) return <div className="leaders" id="leaders" hidden></div>;
  return (
    <div className="leaders" id="leaders">
      {top.map(({ who, score, line }, i) => (
        <div
          key={who.steamId}
          className={focus === who.steamId ? "plate focus" : "plate"}
          data-p={i + 1}
          data-id={who.steamId}
        >
          <Marble who={who} />
          <span className="pl-text">
            <span className="pl-name">
              <PlayerLink id={who.steamId} text={personaOf(who)} />
            </span>
            <span className="pl-score">{score}</span>
            <span className="pl-gap">{line}</span>
          </span>
          <span className="pl-rank">{PLACE[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function ScorePlates({
  name,
  rows,
  focus,
}: {
  name: string;
  rows: Array<BoardRow>;
  focus: string | null;
}) {
  const points = isPoints(name),
    lead = rows[0] as BoardRow | undefined;
  return (
    <Plates
      focus={focus}
      top={rows.slice(0, 3).map((r, i) => {
        const gap = points ? (lead?.score ?? 0) - r.score : r.score - (lead?.score ?? 0);
        return {
          who: r,
          score: value(name, r.score),
          line:
            i === 0
              ? "sets the pace"
              : points
                ? fmtN(gap) + " pts back"
                : "+" + fmtTime(gap) + " back",
        };
      })}
    />
  );
}

/* the podium order's marble row; equal counts share a rank (1, 2, 2, 4) */
export function PodiumPlates({ tally }: { tally: PodiumTally }) {
  const shared = new Map<number, number>();
  for (const p of tally.players) shared.set(p.rank, (shared.get(p.rank) ?? 0) + 1);
  return (
    <Plates
      focus={null}
      top={tally.players.slice(0, 3).map((p) => ({
        who: p,
        score: <MedalCounts p={p} />,
        line:
          ((shared.get(p.rank) ?? 0) > 1 ? "tied · " : "") +
          `on ${String(podiumTotal(p))} of ${String(tally.tracks)} podiums`,
      }))}
    />
  );
}

export function SortSwitch({ name, podiums }: { name: string; podiums: boolean }) {
  return (
    <span className="sortsw" id="sortsw">
      <span className="eyebrow">Sort by</span>
      <span className="sw">
        <Link href={boardHref(name)} aria-current={podiums ? undefined : "page"}>
          Points
        </Link>
        <Link href={boardHref(name, PODIUM_SORT)} aria-current={podiums ? "page" : undefined}>
          Podiums
        </Link>
      </span>
    </span>
  );
}

export function TrackCard({
  b,
  rows,
  scores,
}: {
  b: IndexBoard;
  rows: Array<BoardRow>;
  scores: ReadonlyArray<number>;
}) {
  const t = TRACKS[b.name] as (typeof TRACKS)[string] | undefined;
  const lead = rows[0] as BoardRow | undefined;
  return (
    <div className={t ? "bcard" : "bcard nopic"} id="bcard">
      {t && <img className="bc-pic" src={t.img} alt="" />}
      <div className="bc-body">
        <div className="bc-top">
          <div>
            <h1>{trackNo(b.display)}</h1>
            <span className="bc-by">
              {b.group}
              {b.tier ? " · " + b.tier : ""}
            </span>
          </div>
          <Facts
            facts={[
              ["Runs", fmtN(b.entryCount)],
              ["Record", lead ? fmtTime(lead.score) : "—"],
              [
                "Record holder",
                lead ? <PlayerLink id={lead.steamId} text={personaOf(lead)} /> : "—",
              ],
            ]}
          />
        </div>
        {t && <Spread ts={scores} medals={t.medals} wide />}
        {t && <p className="bc-cap">Track screenshot from the game.</p>}
      </div>
    </div>
  );
}

function StandRow({
  who,
  bar,
  fig,
}: {
  who: BoardRow | PodiumPlayer;
  bar: React.ReactNode;
  fig: React.ReactNode;
}) {
  return (
    <div style={{ "--h": hueFor(who.steamId) } as React.CSSProperties}>
      <span>{personaOf(who)}</span> <i>{bar}</i>
      <b>{fig}</b>
    </div>
  );
}

/* where a Track has its screenshot, an Overall board has its top six as bars, drawn by the
   order in use: points, or gold, silver and bronze stacked (ranked golds first, so the
   longest bar need not be the top one) */
export function OverallCard({
  b,
  rows,
  tally,
  tracks,
  podiums,
}: {
  b: IndexBoard;
  rows: Array<BoardRow>;
  tally: PodiumTally | null;
  tracks: number;
  podiums: boolean;
}) {
  /* the tally ranks golds first, so the most podiums need not be the top one */
  const most = tally?.players.length
    ? tally.players.reduce((a, p) => (podiumTotal(p) > podiumTotal(a) ? p : a))
    : null;
  const top = tally?.players.slice(0, 6) ?? [];
  const widest = Math.max(...top.map(podiumTotal));
  const facts: Array<[string, React.ReactNode]> = [
    ["Players", fmtN(b.entryCount)],
    ["Leader", rows[0] ? <PlayerLink id={rows[0].steamId} text={personaOf(rows[0])} /> : "—"],
  ];
  if (most)
    facts.push([
      "Most podiums",
      <>
        <PlayerLink id={most.steamId} text={personaOf(most)} /> · {podiumTotal(most)}
      </>,
    ]);
  return (
    <div className="bcard" id="bcard">
      <div className="stand">
        {podiums && tally
          ? top.map((p) => (
              <StandRow
                key={p.steamId}
                who={p}
                bar={[p.gold, p.silver, p.bronze].map((n, j) => (
                  <u
                    key={j}
                    className={`m${String(j + 1)}`}
                    style={{ width: ((n / widest) * 100).toFixed(1) + "%" }}
                  ></u>
                ))}
                fig={podiumTotal(p)}
              />
            ))
          : rows
              .slice(0, 6)
              .map((r) => (
                <StandRow
                  key={r.steamId}
                  who={r}
                  bar={
                    <u style={{ width: ((r.score / rows[0].score) * 100).toFixed(1) + "%" }}></u>
                  }
                  fig={fmtN(r.score)}
                />
              ))}
      </div>
      <div className="bc-body">
        <div className="bc-top">
          <div>
            <h1>{b.display}</h1>
            <span className="bc-by">
              {b.group} · points{tally ? " and podiums" : ""} across all {fmtN(tracks)} tracks
              <QMark always={podiums} />
            </span>
          </div>
          <Facts facts={facts} />
        </div>
      </div>
    </div>
  );
}
