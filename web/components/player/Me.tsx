"use client";
// "This is me" on a player's page, and the score card it brings: with it set, anyone
// else's page reads your record (useYou) and shows you against them. The page is drawn
// first and the card lands when your record does.
import Link from "next/link";

import { Score } from "./Score";
import { Marble } from "../Marble";
import { setMe, useMe, useYou } from "../../hooks/me";
import { matchup, type PlayerRecord } from "../../lib/player";
import { vsHref } from "../../lib/routes";
import { personaOf, plural } from "../../lib/rules";

/* "This is me" on a page nobody has claimed, "This is you" with undo on your own, and
   nothing on anyone else's */
export function MeMark({ id }: { id: string }) {
  const me = useMe();
  if (me === id)
    return (
      <span className="pme">
        <span className="you">This is you</span>{" "}
        <button
          type="button"
          className="linkbtn"
          data-me=""
          onClick={() => {
            setMe(null);
          }}
        >
          undo
        </button>
      </span>
    );
  if (me) return null;
  return (
    <span className="pme">
      <button
        type="button"
        className="mebtn"
        data-me={id}
        onClick={() => {
          setMe(id);
        }}
      >
        This is me
      </button>
    </span>
  );
}

/* the score card: you against the player on screen, on every page but your own */
export function ScoreCard({ rec }: { rec: PlayerRecord }) {
  const you = useYou();
  if (you.state !== "ready" || you.id === rec.id) return null;
  const { id: me, rec: mine } = you;
  const t = matchup(mine, rec).tally.all;
  return (
    <div className="mecard">
      <span className="side">
        <Marble who={mine.who} />
        <span>
          <b>You</b>
          <small>{personaOf(mine.who)}</small>
        </span>
      </span>{" "}
      <span className="mid">
        <Score t={t} />
        <small className="eyebrow">{plural(t.n, "shared map", "shared maps")}</small>
      </span>{" "}
      <span className="side r">
        <span>
          <b>{personaOf(rec.who)}</b>
        </span>
        <Marble who={rec.who} />
      </span>{" "}
      <Link className="go" href={vsHref(me, rec.id)}>
        Head to head &rarr;
      </Link>
    </div>
  );
}
