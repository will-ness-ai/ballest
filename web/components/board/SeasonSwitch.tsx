// The Circuit's season switch: on a desktop, a row of sub-tabs under the main tabs; on a
// phone, a chip beside the board button whose menu gives each season's Tracks and field.
// Each season opens its Overall board, so a switch never lands on a Track the other season
// doesn't have.
import Link from "next/link";

import { SeasonMenu } from "./SeasonMenu";
import { boardHref } from "../../lib/routes";
import type { seasonsOf } from "../../lib/player";
import { fmtN } from "../../lib/rules";

export type Season = ReturnType<typeof seasonsOf>[number];

export function SeasonTabs({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <nav className="seasontabs" aria-label="Season">
      {seasons.map((s) => (
        <Link key={s.group} href={boardHref(s.overall)} aria-current={s.group === on}>
          {s.group}
        </Link>
      ))}
    </nav>
  );
}

export function SeasonChip({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <SeasonMenu label={on}>
      {seasons.map((s) => (
        <Link key={s.group} href={boardHref(s.overall)} aria-current={s.group === on}>
          <b>{s.group}</b>
          <small>
            {s.tracks} Tracks · {fmtN(s.players)} players
          </small>
        </Link>
      ))}
    </SeasonMenu>
  );
}
