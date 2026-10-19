// ============================ PROTOTYPE (grill-design, trending) ============================
// Never merged. Joins the Steam snapshot onto the homepage's Map cards for the variants.
import snap from "./steam-snapshot.json";
import { HIDDEN, picks, type MapCard } from "../../lib/workshop";
import type { Proto, ProtoCard } from "./Trending";

const SNAP = snap as unknown as Record<string, [number, number, number, number] | undefined>;

export function protoData(maps: ReadonlyArray<MapCard>): Proto {
  const cards: Array<ProtoCard> = maps
    .filter((m) => !HIDDEN[m.pfid])
    .map((m) => {
      const [week, up, down, score] = SNAP[m.pfid] ?? [0, 0, 0, 0];
      return { ...m, week, up, down, score };
    });
  const by = (f: (m: ProtoCard) => number) => [...cards].sort((a, b) => f(b) - f(a));
  const byId = new Map(cards.map((c) => [c.pfid, c]));
  const others = picks(maps)
    .filter((p) => p.sort !== "plays" && p.sort !== "runs")
    .flatMap((p) => {
      const m = byId.get(p.m.pfid);
      return m ? [{ label: p.label, sort: p.sort, m }] : [];
    });
  const trending = by((m) => m.week).slice(0, 10);
  return {
    others,
    trending,
    rated: by((m) => m.score).slice(0, 10),
    newest: by((m) => m.created).slice(0, 5),
    /* heat: plays this week, lifted by the rating (score ~0.5 for an unrated Map) */
    hot: by((m) => m.week * (0.5 + m.score)).slice(0, 15),
  };
}
// ========================== end PROTOTYPE (grill-design, trending) ==========================
