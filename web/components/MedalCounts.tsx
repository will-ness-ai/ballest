// A player's podium counts, gold, silver and bronze, each with its coloured dot and a
// greyed zero: on a board's podium column and plates, and a player's page. No state, so
// server and client components both use it.
import type { Medals } from "../lib/podiums";

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
