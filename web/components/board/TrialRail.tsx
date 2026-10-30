// The Trials down the left of a Trial's board on a desktop, and in the sheet on a phone: each
// one named, with its record and runs, the one on screen lit (grill-design round 2, A). An
// Event board is read once and never again, so it says it is closed.
import Link from "next/link";

import { eventOfBoard } from "../../lib/campaigns";
import { TRIALS } from "../../lib/circuit";
import { fmtTime, plural } from "../../lib/rules";

export function TrialRailItems({
  tops,
  current,
}: {
  tops: ReadonlyArray<{ board: string; runs: number; record: number | null }>;
  current: string;
}) {
  return TRIALS.map((t) => {
    const top = tops.find((x) => x.board === t.board);
    const runs = plural(top?.runs ?? 0, "run", "runs");
    return (
      <Link
        key={t.board}
        className="tstrip plain trial"
        href={t.page}
        aria-current={t.board === current}
      >
        <span className="lab">
          <b>{t.title}</b>
          <span>
            <span className="rt">{top?.record != null ? fmtTime(top.record) : "No times yet"}</span>{" "}
            <small>
              {runs}
              {eventOfBoard(t.board) ? " · closed" : ""}
            </small>
          </span>
        </span>
      </Link>
    );
  });
}
