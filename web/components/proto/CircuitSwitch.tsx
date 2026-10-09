// PROTOTYPE (grill-design, Circuit tab): every variant's season switch is rendered, and
// the stylesheet shows the one `?variant=` names (proto.css). Never merged.
import Link from "next/link";

export interface Season {
  group: string;
  label: string;
  href: string;
}

/* A · Segmented: a three-way switch at the top of the rail (the sheet's top on a phone) */
export function SwitchSegmented({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <nav className="pv pv-A pseg" aria-label="Season">
      {seasons.map((s) => (
        <Link key={s.group} href={s.href} aria-current={s.group === on}>
          {s.group}
        </Link>
      ))}
    </nav>
  );
}

/* B · Sub-tabs: a second, smaller tab row under the main tabs, across the page */
export function SwitchSubtabs({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <nav className="pv pv-B psub" aria-label="Season">
      {seasons.map((s) => (
        <Link key={s.group} href={s.href} aria-current={s.group === on}>
          {s.group}
        </Link>
      ))}
    </nav>
  );
}

/* C · Dropdown: the rail's heading opens a menu of seasons; on a phone a chip beside the
   board button does */
export function SwitchDropdown({
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
      <div className="pmenu">
        {seasons.map((s) => (
          <Link key={s.group} href={s.href} aria-current={s.group === on}>
            {s.group}
          </Link>
        ))}
      </div>
    </details>
  );
}

/* D · Accordion: every season is a heading in the rail; the one on screen is open with its
   boards, the others are links to their Overall board */
export function SwitchAccordion({
  seasons,
  on,
  children,
}: {
  seasons: ReadonlyArray<Season>;
  on: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pv pv-D pacc">
      {seasons.map((s) =>
        s.group === on ? (
          <div key={s.group} className="pacc-open">
            <h3>
              {s.group} <span aria-hidden="true">&#9662;</span>
            </h3>
            <div className="boards">{children}</div>
          </div>
        ) : (
          <Link key={s.group} className="pacc-shut" href={s.href}>
            {s.group} <span aria-hidden="true">&#9656;</span>
          </Link>
        ),
      )}
    </div>
  );
}

/* E · Chips: the seasons as chips above the board's card, on every size */
export function SwitchChips({ seasons, on }: { seasons: ReadonlyArray<Season>; on: string }) {
  return (
    <nav className="pv pv-E pchips" aria-label="Season">
      <span className="pchips-lab">Circuit</span>
      {seasons.map((s) => (
        <Link key={s.group} href={s.href} aria-current={s.group === on}>
          {s.group}
        </Link>
      ))}
    </nav>
  );
}
