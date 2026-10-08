// The Daily page's Days | Standings switch, at the top of both: the days (the calendar and
// a day's panel) and the all-time standings. No state, so it stays a server component.
import Link from "next/link";

import { dailyHref, dailyStandingsHref } from "../../lib/routes";

export function DailySwitch({ on }: { on: "days" | "standings" }) {
  return (
    <nav className="ds-switch" aria-label="Daily">
      <Link href={dailyHref()} aria-current={on === "days" ? "page" : undefined}>
        Days
      </Link>
      <Link href={dailyStandingsHref()} aria-current={on === "standings" ? "page" : undefined}>
        Standings
      </Link>
    </nav>
  );
}
