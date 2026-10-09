// A board's ranked row: rank, marble, name, the gap to the leader and to the place above,
// the score, and the mark beside it. A board's list draws it, and so can any page with a
// ranked board of its own. No state, so server and client components both use it.
import { memo } from "react";

import { Marble } from "../Marble";
import { MedalCounts } from "../MedalCounts";
import { PlayerLink } from "../PlayerLink";
import type { Medals } from "../../lib/podiums";
import { fmtN, fmtTime, hueFor, ord, personaOf } from "../../lib/rules";
import type { BoardRow } from "../../lib/rows";

/* memoised: a board's list only ever grows, so a new step draws only its own rows.
   `leads` is what rank 1 says in place of a gap, and `mark` what sits beside the score
   (the player's colour chip unless given). */
export const ScoreRow = memo(function ScoreRow({
  r,
  lead,
  points,
  pods,
  focus,
  leads = "Leads the board",
  mark,
  skin,
}: {
  r: BoardRow;
  /* the leader's score, which the first gap is to */
  lead: number;
  points: boolean;
  /* each podium player's counts, when the board has a tally */
  pods: Record<string, Medals> | null;
  focus: boolean;
  leads?: string;
  mark?: React.ReactNode;
  /* PROTOTYPE: the skin the run wore */
  skin?: string;
}) {
  const gap = points ? lead - r.score : r.score - lead;
  const prev = r.ahead;
  const step = prev == null ? 0 : points ? prev - r.score : r.score - prev;
  const g = points ? fmtN(gap) + " pts" : "+" + fmtTime(gap);
  const st = points ? fmtN(step) + " pts" : "+" + fmtTime(step);
  const up = ord(r.rank - 1);
  /* a composite row says where its total came from: "S1 260,000 · S2 188,560". The
     narrow line has no room for that and both gaps, so there the breakdown takes the
     place of the gap to the leader. */
  const parts = r.seasons
    ? " · " +
      Object.entries(r.seasons)
        .map(([season, n]) => season.replace(/^Season\s*/i, "S") + " " + fmtN(n))
        .join(" · ")
    : "";
  const p = pods ? pods[r.steamId] : undefined;
  return (
    <div
      className={focus ? "row focus" : "row"}
      style={{ "--h": hueFor(r.steamId) } as React.CSSProperties}
      data-m={r.rank <= 3 ? r.rank : 0}
      data-id={r.steamId}
    >
      <span className="c-rank">{r.rank}</span>
      <Marble who={r} skin={skin} />
      <span className="c-text">
        <span className="nm">
          <PlayerLink id={r.steamId} text={personaOf(r)} />
        </span>
        {r.rank === 1 ? (
          <>
            <span className="sub sub-d">
              {leads}
              {parts}
            </span>
            <span className="sub sub-m">
              {leads}
              {parts}
            </span>
          </>
        ) : (
          <>
            <span className="sub sub-d">
              <em>{g}</em> behind · {st} to {up}
              {parts}
            </span>{" "}
            <span className="sub sub-m">
              <em>{st}</em> to {up}
              {parts || " · " + g + " back"}
            </span>
          </>
        )}
      </span>
      {pods && <span className="c-pods">{p ? <MedalCounts p={p} /> : null}</span>}
      <span className="c-score">
        <span>{points ? fmtN(r.score) : fmtTime(r.score)}</span>
        {mark ?? <i className="pill"></i>}
      </span>
    </div>
  );
});
