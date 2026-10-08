"use client";
// You on this board, above its plates: your place, your score and the Medal it holds, a bar
// toward the next Medal, and a link that opens the board at your row. It draws nothing
// until your row has been read, so the server's page is the same for everyone.
import Link from "next/link";

import { Marble } from "../Marble";
import { useYouOnBoard } from "../../hooks/you";
import { boardHref, playersHref } from "../../lib/routes";
import { MEDALS, MEDAL_LABEL, fmtN, fmtTime, isPoints, ord, type MedalKey } from "../../lib/rules";
import { standingOn, type BoardFacts, type MedalName } from "../../lib/standing";

const COLOR = Object.fromEntries(MEDALS.map(([name, c]) => [name, c])) as Record<MedalName, string>;

function MedalWord({ medal }: { medal: MedalName }) {
  return <b style={{ color: COLOR[medal] }}>{medal}</b>;
}

/* what follows your score: the Medal it holds, the record, or nothing */
function held(medal: MedalKey | null) {
  if (medal === "wr") return <>, the world record</>;
  if (!medal || medal === "none") return null;
  return (
    <>
      {" "}
      for <MedalWord medal={MEDAL_LABEL[medal] as MedalName} />
    </>
  );
}

export function YouBanner(board: BoardFacts) {
  const you = useYouOnBoard(board.name);
  if (you.kind === "loading") return null;
  if (you.kind === "unset")
    return (
      <div className="you-banner yb-empty">
        <p>
          Mark your player page with <b>This is me</b> to see where you stand here.
        </p>
        <Link className="go" href={playersHref("all", "wr")}>
          Find yourself
        </Link>
      </div>
    );
  if (you.kind === "unplayed")
    return (
      <div className="you-banner yb-empty">
        <p>
          {isPoints(board.name)
            ? "You have no points on this board yet."
            : "You haven’t set a time here yet."}
        </p>
      </div>
    );
  const s = standingOn(board, you.row);
  const score = s.points ? fmtN(you.row.score) + " pts" : fmtTime(you.row.score);
  return (
    <div className="you-banner">
      <Marble who={{ steamId: you.id }} />
      <div className="yb-t">
        <p>
          You&apos;re <b>{ord(s.place)}</b> of {fmtN(s.field)} with <b>{score}</b>
          {held(s.medal)}.
        </p>
        {s.next && (
          <p className="yb-next">
            <span className="yb-bar" aria-hidden="true">
              <span
                style={
                  { "--p": s.next.progress, background: COLOR[s.next.medal] } as React.CSSProperties
                }
              />
            </span>
            <small>
              <b style={{ color: COLOR[s.next.medal] }}>{fmtTime(s.next.by)}</b> to {s.next.medal}
            </small>
          </p>
        )}
      </div>
      <Link className="go" href={boardHref(board.name, you.id)}>
        Jump to my row
      </Link>
    </div>
  );
}
