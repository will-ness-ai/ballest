// How every run on a board spreads out, as a chart with the Medal cut-offs: a Circuit
// Track's card and a Map's panel. No state, so the server draws it; YouSpread draws it
// again in the browser with You's run on it.
import {
  MEDALS,
  SCORE_TICKS_PER_SECOND,
  fmtN,
  fmtSec,
  fmtTime,
  hueFor,
  plural,
} from "../../lib/rules";
import { markOn, type SpreadChart } from "../../lib/spread";

/* You's run on the chart: your score, and your Steam ID for your marble's hue */
export interface SpreadYou {
  score: number;
  id: string;
}

/* `chart` is every run's spread (spreadOf), `medals` [bronze, silver, gold, author] in
   seconds. `wide` is a Circuit track's header card: each line carries its Medal's name and
   time, staggered over two rows so neighbouring labels don't collide. `you` adds your run
   as a line in your marble's hue, held at the right edge with an arrow when it is past it. */
export function Spread({
  chart,
  medals,
  wide,
  you = null,
}: {
  chart: SpreadChart;
  medals: ReadonlyArray<number>;
  wide: boolean;
  you?: SpreadYou | null;
}) {
  const s = chart.scale;
  if (!s) return <p className="sp-cap">{chart.runs ? "One run so far." : "No runs yet."}</p>;
  const { lo, hi, bins, over } = s;
  const W = wide ? 560 : 320,
    H = wide ? 132 : 118,
    top = wide ? 30 : 16,
    base = H - 22,
    bw = W / bins.length,
    max = Math.max(...bins);
  const x = (t: number) => (((t - lo) / (hi - lo)) * W).toFixed(1);
  return (
    <>
      <svg
        className="spread"
        viewBox={`-8 -8 ${String(W + 16)} ${String(H + 8)}`}
        role="img"
        aria-label={`How all ${String(chart.runs)} run times spread out, with the medal cut-offs${you ? " and your time" : ""}`}
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
        {you && <YouLine you={you} s={s} W={W} top={top} base={base} />}
        <text className="sp-lbl" x="0" y={H - 6}>
          {fmtTime(lo)} record
        </text>
        <text className="sp-lbl" x={W} y={H - 6} textAnchor="end">
          {fmtTime(hi)}
        </text>
      </svg>
      <p className="sp-cap">
        {plural(chart.runs, "run", "runs")}
        {over ? `; the slowest ${fmtN(over)} are off the right edge` : ""}.
      </p>
    </>
  );
}

/* your run: a line with a dot on top and "You" beside it, on the side with room */
function YouLine({
  you,
  s,
  W,
  top,
  base,
}: {
  you: SpreadYou;
  s: { lo: number; hi: number };
  W: number;
  top: number;
  base: number;
}) {
  const { at, past } = markOn(s, you.score);
  const ax = (at * W).toFixed(1);
  const right = at * W < W - 50;
  const c = { "--h": hueFor(you.id) } as React.CSSProperties;
  return (
    <g className="sp-you" style={c}>
      <line x1={ax} x2={ax} y1={top - 4} y2={base} strokeWidth="2.5" />
      <circle cx={ax} cy={top - 4} r="3.5" />
      <text
        x={(at * W + (right ? 5 : -5)).toFixed(1)}
        y={top + 4}
        fontSize="10.5"
        fontWeight="700"
        textAnchor={right ? "start" : "end"}
      >
        {past ? "You →" : "You"}
      </text>
    </g>
  );
}
