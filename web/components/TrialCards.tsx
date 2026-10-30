// /trials: a card per Trial, picture on top, three across on a desktop and one under another
// on a phone (grill-design round 1, A). Each gives its title, whether it is still read, its
// runs and its record with the record's holder (trialTops), and links the Trial's page. A
// Tower's picture waits on the game's files, so its card shows a striped placeholder.
import Link from "next/link";

import { Marble } from "./Marble";
import { TRIALS } from "../lib/circuit";
import type { TrialTop } from "../lib/rows";
import { fmtTime, personaOf, plural } from "../lib/rules";

export function TrialCards({ tops }: { tops: ReadonlyArray<TrialTop> }) {
  return (
    <div className="trcs">
      {TRIALS.map((t) => {
        const top = tops.find((x) => x.board === t.board);
        /* an Event board is read once and never again */
        const status = t.event ? "Closed" : "Open";
        return (
          <Link key={t.board} className="trc" href={t.page}>
            {t.picture ? (
              <img className="trc-pic" src={t.picture} alt="" loading="lazy" />
            ) : (
              <span className="trc-pic trc-none" aria-hidden />
            )}
            <span className="trc-in">
              <span className="eyebrow">
                Trial · {status} · {plural(top?.runs ?? 0, "run", "runs")}
              </span>
              <h2 className="trc-t">{t.title}</h2>
              <span className="trc-by">{t.blurb}</span>
              {top?.holder && top.record != null ? (
                <span className="trc-rec">
                  <Marble who={top.holder} still />
                  <span>
                    <b>{personaOf(top.holder)}</b>{" "}
                    <span className="trc-time">{fmtTime(top.record)}</span>
                  </span>
                </span>
              ) : (
                <span className="trc-by">No times yet</span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
