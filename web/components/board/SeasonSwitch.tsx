// The Circuit's season switch: on a desktop, a row of sub-tabs under the main tabs; on a
// phone, a chip beside the board button whose menu gives each season's Tracks and field.
// Each season opens its Overall board, so a switch never lands on a Track the other season
// doesn't have.
import Link from "next/link";

import { SeasonMenu } from "./SeasonMenu";
import { boardHref } from "../../lib/routes";
import type { Season } from "../../lib/player";
import { fmtN } from "../../lib/rules";

interface Props {
  seasons: ReadonlyArray<Season>;
  on: string;
}

/* each season's link, lit on the season on screen */
const link = (s: Season, on: string) => ({
  href: boardHref(s.overall),
  "aria-current": s.group === on,
});

export function SeasonTabs({ seasons, on }: Props) {
  return (
    <nav className="seasontabs" aria-label="Season">
      {seasons.map((s) => (
        <Link {...link(s, on)} key={s.group}>
          {s.group}
        </Link>
      ))}
    </nav>
  );
}

/* `board` names the menu, since a board page left behind can stay in the document */
export function SeasonChip({ seasons, on, board }: Props & { board: string }) {
  return (
    <SeasonMenu id={`seasons-${board}`} label={on}>
      {seasons.map((s) => (
        <Link {...link(s, on)} key={s.group}>
          <b>{s.group}</b>
          <small>
            {s.tracks} Tracks · {fmtN(s.players)} players
          </small>
        </Link>
      ))}
    </SeasonMenu>
  );
}
