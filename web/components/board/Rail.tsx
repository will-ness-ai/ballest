// The season's boards down the left on a desktop and in the sheet on a phone: Overall in
// words, a Track as a strip of its screenshot with its record. The in-game
// track-selection screen groups Tracks under difficulty headings, and the rail mirrors
// them so it reads like the screen players already know.
import Link from "next/link";

import { TRACKS, trackNo } from "../../lib/circuit";
import type { IndexBoard } from "../../lib/player";
import type { PodiumTally } from "../../lib/podiums";
import { boardHref } from "../../lib/routes";
import { fmtTime, isPoints, plural } from "../../lib/rules";

/* a Track's record without reading its board: the podium tally lists who is 1st on it */
function trackRecord(b: IndexBoard, podiums: ReadonlyArray<PodiumTally>) {
  const pod = podiums.find((s) => s.group === b.group);
  for (const p of pod?.players ?? []) {
    const f = p.finishes.find((x) => x.rank === 1 && x.track === b.display);
    if (f) return f.score;
  }
  return null;
}

function Strip({
  b,
  current,
  podiums,
}: {
  b: IndexBoard;
  current: boolean;
  podiums: ReadonlyArray<PodiumTally>;
}) {
  if (isPoints(b.name))
    return (
      <Link className="tstrip plain" href={boardHref(b.name)} aria-current={current}>
        <span className="lab">
          <b>{b.display}</b> <small>{plural(b.entryCount, "player", "players")}</small>
        </span>
      </Link>
    );
  const t = TRACKS[b.name] as (typeof TRACKS)[string] | undefined,
    rec = trackRecord(b, podiums);
  return (
    <Link className="tstrip" href={boardHref(b.name)} aria-current={current}>
      {t && <img src={t.img} alt="" loading="lazy" decoding="async" />}{" "}
      <span className="lab">
        <b>{trackNo(b.display)}</b>
        <span className="rt">{rec ? fmtTime(rec) : "\u00a0"}</span>{" "}
        <small>{plural(b.entryCount, "run", "runs")}</small>
      </span>
    </Link>
  );
}

export function RailItems({
  boards,
  current,
  podiums,
}: {
  boards: ReadonlyArray<IndexBoard>;
  current: string;
  podiums: ReadonlyArray<PodiumTally>;
}) {
  let tier: string | null = null;
  return boards.map((b) => {
    const head =
      b.tier && b.tier !== tier ? (
        <span className="tierhead" key={"t" + b.name}>
          {b.tier}
        </span>
      ) : null;
    tier = b.tier ?? tier;
    return [head, <Strip key={b.name} b={b} current={b.name === current} podiums={podiums} />];
  });
}
