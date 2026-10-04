// The small pieces the board view and the Workshop share: a player's name as a link, the
// podium counts, a card's facts, the "?" that opens how points work, and the chart of how
// a board's runs spread out. None of them holds state, so server and client both use them.
import Link from "next/link";

import {
  MEDALS,
  SCORE_TICKS_PER_SECOND,
  fmtN,
  fmtSec,
  fmtTime,
  isSteamId,
  plural,
} from "../../lib/rules";
import { playerHref } from "../../lib/routes";

/* rows a board's list adds per scroll step */
export const CHUNK = 50;

/* a name leads to that player's page on this site; the link out to Steam lives there.
   Only a plain Steam64 is ever linked, and anything else renders as flat text. */
export function PlayerLink({ id, text, tab }: { id: string | null; text: string; tab?: string }) {
  return isSteamId(id) ? <Link href={playerHref(id, tab)}>{text}</Link> : <>{text}</>;
}

export interface Medals {
  gold: number;
  silver: number;
  bronze: number;
}
export const podiumTotal = (p: Medals) => p.gold + p.silver + p.bronze;

export function MedalCounts({ p }: { p: Medals }) {
  return (
    <span className="mc">
      {[p.gold, p.silver, p.bronze].map((n, i) => (
        <span key={i} className={`m${String(i + 1)}${n ? "" : " z"}`}>
          <i></i>
          {n}
        </span>
      ))}
    </span>
  );
}

export function Facts({ facts }: { facts: ReadonlyArray<[string, React.ReactNode]> }) {
  return (
    <dl className="bc-facts">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* the "?" that opens how points work (PointsDialog). On a desktop the Points column head
   carries it, so the card's copy shows only on a phone, or with `always` when the board
   is sorted by podiums and there is no Points column */
export function QMark({ always }: { always?: boolean }) {
  return (
    <button
      type="button"
      className={always ? "qmark always" : "qmark"}
      data-ptsx=""
      aria-label="How points work"
    >
      ?
    </button>
  );
}

/* How every run on a board spreads out, with each Medal's cut-off drawn in. `ts` is the
   run times in rank order, `medals` [bronze, silver, gold, author] in seconds. On a Map's
   panel the slowest twentieth is left off the right edge, or one abandoned run would
   squash the rest into a single bar. `wide` is a Circuit track's header card: the chart
   runs to just past Bronze and each line carries its Medal's name and time, staggered
   over two rows so neighbouring labels don't collide. */
export function Spread({
  ts,
  medals,
  wide,
}: {
  ts: ReadonlyArray<number>;
  medals: ReadonlyArray<number>;
  wide: boolean;
}) {
  if (ts.length < 2)
    return <p className="sp-cap">{ts.length ? "One run so far." : "No runs yet."}</p>;
  const lo = ts[0];
  const cut = wide
    ? medals[0] * 1.08 * SCORE_TICKS_PER_SECOND
    : ts[Math.min(ts.length - 1, Math.floor(ts.length * 0.95))];
  const hi = Math.max(cut, lo + 1);
  const N = wide ? 44 : 24,
    bins = new Array<number>(N).fill(0);
  let over = 0;
  for (const t of ts) {
    if (t > hi) {
      over++;
      continue;
    }
    bins[Math.min(N - 1, Math.floor(((t - lo) / (hi - lo)) * N))]++;
  }
  const W = wide ? 560 : 320,
    H = wide ? 132 : 118,
    top = wide ? 30 : 16,
    base = H - 22,
    bw = W / N,
    max = Math.max(...bins);
  const x = (t: number) => (((t - lo) / (hi - lo)) * W).toFixed(1);
  return (
    <>
      <svg
        className="spread"
        viewBox={`-8 -8 ${String(W + 16)} ${String(H + 8)}`}
        role="img"
        aria-label={`How all ${String(ts.length)} run times spread out, with the medal cut-offs`}
      >
        <line className="sp-axis" x1="0" x2={W} y1={base} y2={base} />
        {bins.map((n, i) =>
          n ? (
            <rect
              key={i}
              className="sp-bar"
              x={(i * bw + 1).toFixed(1)}
              y={(base - (n / max) * (base - top)).toFixed(1)}
              width={(bw - 2).toFixed(1)}
              height={((n / max) * (base - top)).toFixed(1)}
              rx="1.5"
            />
          ) : null,
        )}
        {MEDALS.map(([name, c, i], k) => {
          const t = medals[i] * SCORE_TICKS_PER_SECOND;
          if (t < lo || t > hi) return null;
          const at = +x(t),
            anchor = !wide ? "middle" : at < 40 ? "start" : at > W - 40 ? "end" : "middle";
          const label = wide ? name + " " + fmtSec(medals[i]).replace(/^0:/, "") : name[0];
          return (
            <g key={name}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={top - 6}
                y2={base}
                style={{ stroke: c }}
                strokeWidth="1.5"
              />
              <text
                x={x(t)}
                y={top - 9 - (wide && k % 2 ? 12 : 0)}
                style={{ fill: c }}
                fontSize="9.5"
                textAnchor={anchor}
              >
                {label}
              </text>
            </g>
          );
        })}
        <text className="sp-lbl" x="0" y={H - 6}>
          {fmtTime(lo)} record
        </text>
        <text className="sp-lbl" x={W} y={H - 6} textAnchor="end">
          {fmtTime(hi)}
        </text>
      </svg>
      <p className="sp-cap">
        {plural(ts.length, "run", "runs")}
        {over ? `; the slowest ${fmtN(over)} are off the right edge` : ""}.
      </p>
    </>
  );
}
