"use client";
// You on a player's page: Sign out on your own, and on anyone else's, once you're signed in,
// the score card against them (it reads your record with useYou). The page is drawn first
// and the card lands when your record does.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Score } from "./Score";
import { Marble } from "../Marble";
import { useMe, useYou } from "../../hooks/me";
import { matchup, type PlayerRecord } from "../../lib/player";
import { signOutHref, vsHref } from "../../lib/routes";
import { personaOf, plural } from "../../lib/rules";

/* "This is you" and Sign out on your own page, nothing on anyone else's */
export function SignOut({ id }: { id: string }) {
  const me = useMe();
  const path = usePathname();
  if (me !== id) return null;
  return (
    <form className="pme" method="post" action={signOutHref(path)}>
      <span className="you">This is you</span>{" "}
      <button type="submit" className="linkbtn">
        Sign out
      </button>
    </form>
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
