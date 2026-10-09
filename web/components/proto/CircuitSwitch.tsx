// PROTOTYPE (grill-design, Circuit tab, round 2): five takes on the season dropdown Will
// picked in round 1. Every variant is rendered, and proto.css shows the one `?variant=`
// names. Never merged.
import Link from "next/link";

import { NativeSeason } from "./NativeSeason";

export interface Season {
  group: string;
  href: string;
  /* the season's Overall board's field, and how many Tracks it covers */
  players: number;
  tracks: number;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function Menu({
  seasons,
  on,
  rich,
}: {
  seasons: ReadonlyArray<Season>;
  on: string;
  rich?: boolean;
}) {
  return (
    <div className={rich ? "pmenu prich" : "pmenu"}>
      {seasons.map((s) => (
        <Link key={s.group} href={s.href} aria-current={s.group === on}>
          <b>{s.group}</b>
          {rich && (
            <small>
              {s.tracks} Tracks · {fmt(s.players)} players
            </small>
          )}
        </Link>
      ))}
    </div>
  );
}

/* A · Heading menu (round 1's C): the rail's heading opens the menu; on a phone, a chip
   beside the board button */
export function DropHeading({
  seasons,
  on,
  where,
}: {
  seasons: ReadonlyArray<Season>;
  on: string;
  where: "rail" | "phone";
}) {
  return (
    <details className={`pv pv-A pdrop pdrop-${where}`}>
      <summary>
        {on} <span aria-hidden="true">&#9662;</span>
      </summary>
      <Menu seasons={seasons} on={on} />
    </details>
  );
}

/* B · Field: a boxed, labelled field at the top of the rail and across a phone, like a
   form's select */
export function DropField({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <details className="pv pv-B pfield">
      <summary>
        <span className="pfield-lab">Season</span>
        <span className="pfield-val">{on}</span>
        <span className="pfield-chev" aria-hidden="true">
          &#9662;
        </span>
      </summary>
      <Menu seasons={seasons} on={on} />
    </details>
  );
}

/* C · Rich menu: A's trigger, with each season's Tracks and field in the menu */
export function DropRich({
  seasons,
  on,
  where,
}: {
  seasons: ReadonlyArray<Season>;
  on: string;
  where: "rail" | "phone";
}) {
  return (
    <details className={`pv pv-C pdrop pdrop-${where}`}>
      <summary>
        {on} <span aria-hidden="true">&#9662;</span>
      </summary>
      <Menu seasons={seasons} on={on} rich />
    </details>
  );
}

/* D · Breadcrumb: "Circuit › Season 2 ▾ › Overall" above the board's card on every size;
   the rail keeps its plain heading */
export function DropCrumb({
  seasons,
  on,
  board,
}: {
  seasons: ReadonlyArray<Season>;
  on: string;
  board: string;
}) {
  return (
    <div className="pv pv-D pcrumb">
      <span>Circuit</span>
      <span aria-hidden="true">&#8250;</span>
      <details className="pdrop">
        <summary>
          {on} <span aria-hidden="true">&#9662;</span>
        </summary>
        <Menu seasons={seasons} on={on} />
      </details>
      <span aria-hidden="true">&#8250;</span>
      <b>{board}</b>
    </div>
  );
}

/* E · Native: the browser's own select, so a phone opens its system picker */
export function DropNative({
  seasons,
  on,
  where,
}: {
  seasons: ReadonlyArray<Season>;
  on: string;
  where: "rail" | "phone";
}) {
  return (
    <div className={`pv pv-E pnative pnative-${where}`}>
      <NativeSeason seasons={seasons} on={on} />
    </div>
  );
}

/* Desktop, settled in round 1 (B): a second, smaller tab row under the main tabs */
export function SeasonTabs({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <nav className="psub" aria-label="Season">
      {seasons.map((s) => (
        <Link key={s.group} href={s.href} aria-current={s.group === on}>
          {s.group}
        </Link>
      ))}
    </nav>
  );
}
