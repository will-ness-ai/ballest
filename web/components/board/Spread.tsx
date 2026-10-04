// How every run on a board spreads out, as a chart with the Medal cut-offs: a Circuit
// Track's card and a Map's panel. No state, so the server draws it.
import { MEDALS, SCORE_TICKS_PER_SECOND, fmtN, fmtSec, fmtTime, plural } from "../../lib/rules";

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
