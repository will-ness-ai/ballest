"use client";
// You on this board, above its plates: your place, your score and the Medal it holds, a bar
// toward the next Medal, and a link that opens the board at your row. It draws nothing
// until your row has been read, so the server's page is the same for everyone; once a
// session is known it holds the banner's place while the row is read, so the plates don't
// jump down when it lands.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Marble } from "../Marble";
import { useYouOnBoard } from "../../hooks/you";
import { boardHref, signInHref } from "../../lib/routes";
import {
  MEDAL_COLOR,
  MEDAL_LABEL,
  fmtN,
  fmtTime,
  isPoints,
  ord,
  type MedalKey,
  type TargetMedal,
} from "../../lib/rules";
import { medalsOn, standingOn, type BoardFacts } from "../../lib/standing";

function MedalWord({ medal }: { medal: TargetMedal }) {
  return <b style={{ color: MEDAL_COLOR[medal] }}>{MEDAL_LABEL[medal]}</b>;
}

/* what follows your score: the Medal it holds, the record, or nothing */
function held(medal: MedalKey | null) {
  if (medal === "wr") return <>, the world record</>;
  if (!medal || medal === "none") return null;
  return (
    <>
      {" "}
      for <MedalWord medal={medal} />
    </>
  );
}

/* the banner's place while your row is read: a played banner's parts, unseen, so it takes
   the same room at any width, with the bar on a board that has Medals */
function Holder({ bar }: { bar: boolean }) {
  return (
    <div className="you-banner yb-wait" aria-hidden="true">
      <span className="marble" />
      <div className="yb-t">
        <p>&nbsp;</p>
        {bar && (
          <p className="yb-next">
            <span className="yb-bar" />
            <small>&nbsp;</small>
          </p>
        )}
      </div>
      <span className="go">Jump to your place</span>
    </div>
  );
}

export function YouBanner(board: BoardFacts) {
  const you = useYouOnBoard(board.name);
  const path = usePathname();
  if (you.kind === "loading") return you.claimed ? <Holder bar={medalsOn(board) != null} /> : null;
  if (you.kind === "none")
    return (
      <div className="you-banner yb-empty">
        <p>Sign in to see where you stand here.</p>
        <a className="go" href={signInHref(path)}>
          Sign in with Steam
        </a>
      </div>
    );
  if (you.kind === "unknown")
    return (
      <div className="you-banner yb-empty">
        <p>Your Steam account has no times on the boards yet.</p>
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
      <Marble who={you.who} />
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
                  {
                    "--p": s.next.progress,
                    background: MEDAL_COLOR[s.next.medal],
                  } as React.CSSProperties
                }
              />
            </span>
            <small>
              <b style={{ color: MEDAL_COLOR[s.next.medal] }}>{fmtTime(s.next.by)}</b> to{" "}
              {MEDAL_LABEL[s.next.medal]}
            </small>
          </p>
        )}
      </div>
      <Link className="go" href={boardHref(board.name, you.who.steamId)}>
        Jump to your place
      </Link>
    </div>
  );
}
