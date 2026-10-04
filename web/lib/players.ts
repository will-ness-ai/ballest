// The Players table's ranking: every player ranked by one count (world records, podiums,
// top 5s or Maps finished) on the Circuit, the Workshop or both. Equal counts share a rank
// (1, 2, 2, 4), and inside a tie the other columns, then the name, then the Steam ID decide
// the order. Pure, so the server render and the browser rank alike.
import { personaOf } from "./rules";
import type { PlScope, PlSort } from "./routes";
import type { StandingsRow } from "./rows";

export const PL_SCOPE_LABELS: ReadonlyArray<[PlScope, string]> = [
  ["all", "All"],
  ["circuit", "Circuit"],
  ["workshop", "Workshop"],
];

/* key, header, what one of it is called, and how a player with one is described */
export const PL_COLS: ReadonlyArray<[PlSort, string, [string, string], string]> = [
  ["wr", "WRs", ["world record", "world records"], "a world record"],
  ["pod", "Podiums", ["podium", "podiums"], "a podium"],
  ["t5", "Top 5s", ["top 5", "top 5s"], "a top 5"],
  ["maps", "Maps", ["map finished", "maps finished"], "a Workshop time"],
];
export const plCol = (sort: PlSort) => PL_COLS.find((c) => c[0] === sort) ?? PL_COLS[0];

/* the Circuit has no Maps column: nobody finishes a Map there */
export const plCols = (scope: PlScope) =>
  PL_COLS.filter((c) => scope !== "circuit" || c[0] !== "maps");

/* a scope and sort the table shows; the Circuit sorted by Maps is not one */
export const plValid = (scope: PlScope, sort: PlSort) => !(scope === "circuit" && sort === "maps");

export interface PlPlayer {
  steamId: string;
  persona: string;
  c: { wr: number; pod: number; t5: number };
  w: { wr: number; pod: number; t5: number };
  maps: number;
}

export const plPlayer = ([
  steamId,
  persona,
  cwr,
  wwr,
  cpod,
  wpod,
  ct5,
  wt5,
  maps,
]: StandingsRow): PlPlayer => ({
  steamId,
  persona,
  c: { wr: cwr, pod: cpod, t5: ct5 },
  w: { wr: wwr, pod: wpod, t5: wt5 },
  maps,
});

export const plVal = (p: PlPlayer, k: PlSort, scope: PlScope) =>
  k === "maps"
    ? scope === "circuit"
      ? 0
      : p.maps
    : scope === "circuit"
      ? p.c[k]
      : scope === "workshop"
        ? p.w[k]
        : p.c[k] + p.w[k];

export interface PlRanked {
  p: PlPlayer;
  /* the sorted column's count */
  v: number;
  rank: number;
}

/* everyone with at least one of the sorted count, ranked */
export function plRank(players: ReadonlyArray<PlPlayer>, scope: PlScope, sort: PlSort) {
  const others = PL_COLS.map((c) => c[0]).filter((k) => k !== sort);
  const rows = players
    .map((p) => ({
      p,
      v: plVal(p, sort, scope),
      o: others.map((k) => plVal(p, k, scope)),
      rank: 0,
    }))
    .filter((r) => r.v > 0)
    .sort(
      (a, b) =>
        b.v - a.v ||
        a.o.reduce((d, x, i) => d || b.o[i] - x, 0) ||
        personaOf(a.p).localeCompare(personaOf(b.p)) ||
        (a.p.steamId < b.p.steamId ? -1 : 1),
    );
  rows.forEach((r, i) => {
    r.rank = i && r.v === rows[i - 1].v ? rows[i - 1].rank : i + 1;
  });
  return rows.map(({ p, v, rank }): PlRanked => ({ p, v, rank }));
}
