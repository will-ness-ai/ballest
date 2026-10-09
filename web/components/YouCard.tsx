"use client";
// You's card in the header, on every page: your marble and name, with your All Seasons place
// and Maps played on a desktop, linking to your page. Signed out, it is Sign in with Steam,
// coming back to this page; signed in as a Steam ID on no board yet, it is Sign out, since
// that player has no page to sign out from. Drawn once the browser can tell which, so a
// signed-in visitor never sees Sign in flash first; while your record is read, a blank card
// holds its place, so on a phone the Refreshed line it replaces doesn't flash back in.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Marble } from "./Marble";
import { SteamMark } from "./SteamMark";
import { useYou } from "../hooks/me";
import { playerHref, signInHref, signOutHref } from "../lib/routes";
import { ord, personaOf, plural } from "../lib/rules";

export function YouCard() {
  const you = useYou();
  const path = usePathname();
  if (you.state === "loading")
    return you.claimed ? (
      <span className="youcard yc-wait" aria-hidden="true">
        <span className="q" />
        <span>
          <b>&nbsp;</b>
          <small>&nbsp;</small>
        </span>
      </span>
    ) : null;
  if (you.state === "none")
    return (
      <a className="youcard find" href={signInHref(path)}>
        <span className="q">
          <SteamMark />
        </span>
        <span>
          <b>
            Sign in<span className="yc-wide"> with Steam</span>
          </b>
          <small>See where you stand</small>
        </span>
      </a>
    );
  if (you.state === "unknown")
    return (
      <form method="post" action={signOutHref(path)}>
        <button type="submit" className="youcard find">
          <span className="q">
            <SteamMark />
          </span>
          <span>
            <b>Sign out</b>
            <small>No times on this account yet</small>
          </span>
        </button>
      </form>
    );
  const { rec } = you;
  return (
    <Link className="youcard" href={playerHref(rec.id)}>
      <Marble who={rec.who} still />
      <span>
        <b>{personaOf(rec.who)}</b>
        <small>
          {rec.allSeasons ? ord(rec.allSeasons.rank) + " All Seasons" : "Unranked"} ·{" "}
          {plural(rec.workshop.maps, "Map", "Maps")}
        </small>
      </span>
    </Link>
  );
}
