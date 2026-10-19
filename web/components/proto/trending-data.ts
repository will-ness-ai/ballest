// ============================ PROTOTYPE (grill-design, trending) ============================
// Never merged. Joins the Steam snapshots and this week's board activity onto the homepage's
// Map cards for the variants.
import extra from "./steam-extra.json";
import snap from "./steam-snapshot.json";
import { HIDDEN, type MapCard } from "../../lib/workshop";
import type { Proto, ProtoCard } from "./Trending";

const SNAP = snap as unknown as Record<string, [number, number, number, number] | undefined>;
const EXTRA = extra as unknown as Record<string, [number, Array<number>, number] | undefined>;

export function protoData(
  maps: ReadonlyArray<MapCard>,
  week: Record<string, [number, number] | undefined>,
): Proto {
  const cards: Array<ProtoCard> = maps
    .filter((m) => !HIDDEN[m.pfid])
    .map((m) => {
      const [, up, down, score] = SNAP[m.pfid] ?? [0, 0, 0, 0];
      const [prev, daily, plays] = EXTRA[m.pfid] ?? [0, [0, 0, 0, 0, 0, 0, 0], 0];
      const [players, runs] = week[m.pfid] ?? [0, 0];
      return { ...m, week: plays, up, down, score, prev, daily, players, runs, prevRank: null };
    });
  const by = (f: (m: ProtoCard) => number) => [...cards].sort((a, b) => f(b) - f(a));
  const prevRank = new Map(by((m) => m.prev).map((m, i) => [m.pfid, i + 1]));
  const top = (f: (m: ProtoCard) => number) =>
    by(f)
      .slice(0, 10)
      .map((m) => {
        const r = prevRank.get(m.pfid) ?? 999;
        /* new this week: published inside the window, or unplayed last week */
        return { ...m, prevRank: m.prev === 0 || r > 99 ? null : r };
      });
  return {
    trending: top((m) => m.week),
    players: top((m) => m.players * 1000 + m.runs),
    blend: top((m) => m.week * (0.5 + m.score)),
  };
}
// ========================== end PROTOTYPE (grill-design, trending) ==========================
