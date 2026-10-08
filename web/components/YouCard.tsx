"use client";
// You's card in the header, on every page: your marble and name, with your All Seasons place
// and Maps played on a desktop, linking to your page. With nobody claimed, or a claim the
// site doesn't know, it leads to Players to find yourself. Drawn once the browser can tell
// which, so a claimed visitor never sees "Find yourself" flash first; while a claim's record
// is read, a blank card holds its place, so on a phone the Refreshed line it replaces
// doesn't flash back in.
import Link from "next/link";

import { Marble } from "./Marble";
import { useYou } from "../hooks/me";
import { findYourselfHref, playerHref } from "../lib/routes";
import { ord, personaOf, plural } from "../lib/rules";

export function YouCard() {
  const you = useYou();
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
      <Link className="youcard find" href={findYourselfHref()}>
        <span className="q" aria-hidden="true">
          ?
        </span>
        <span>
          <b>Find yourself</b>
          <small>Mark your page with This is me</small>
        </span>
      </Link>
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
