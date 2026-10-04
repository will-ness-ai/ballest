// The Players table's ranking (lib/players.ts): who is listed, the shared ranks and the
// order inside a tie.
import { describe, expect, test } from "vitest";

import { plCols, plPlayer, plRank, plValid } from "../lib/players";
import type { StandingsRow } from "../db/site";

/* [steam ID, persona, cwr, wwr, cpod, wpod, ct5, wt5, maps] */
const ROWS: Array<StandingsRow> = [
  ["76561190000000001", "Ada", 2, 1, 3, 1, 4, 2, 10],
  ["76561190000000002", "Bo", 0, 3, 0, 4, 0, 5, 20],
  ["76561190000000003", "Cy", 3, 0, 3, 0, 3, 0, 0],
  ["76561190000000004", "", 0, 0, 1, 0, 2, 0, 1],
  ["76561190000000005", "Al", 3, 0, 3, 0, 3, 0, 0],
];
const players = ROWS.map(plPlayer);
const order = (scope: Parameters<typeof plRank>[1], sort: Parameters<typeof plRank>[2]) =>
  plRank(players, scope, sort).map((r) => [r.p.persona || r.p.steamId.slice(-1), r.v, r.rank]);

describe("plRank", () => {
  test("All adds the Circuit and the Workshop, and equal counts share a rank", () => {
    expect(order("all", "wr")).toEqual([
      ["Ada", 3, 1],
      ["Bo", 3, 1],
      ["Al", 3, 1],
      ["Cy", 3, 1],
    ]);
  });
  test("inside a tie the other columns decide, then the name", () => {
    /* Ada and Bo lead Al and Cy on podiums; Al and Cy tie throughout, so the name decides */
    expect(order("all", "wr").map((r) => r[0])).toEqual(["Ada", "Bo", "Al", "Cy"]);
  });
  test("only players with one of the count are listed, ranks skip after a tie", () => {
    expect(order("circuit", "pod")).toEqual([
      ["Al", 3, 1],
      ["Cy", 3, 1],
      ["Ada", 3, 1],
      ["4", 1, 4],
    ]);
    expect(order("workshop", "maps")).toEqual([
      ["Bo", 20, 1],
      ["Ada", 10, 2],
      ["4", 1, 3],
    ]);
  });
  test("the Circuit has no Maps", () => {
    expect(plValid("circuit", "maps")).toBe(false);
    expect(plCols("circuit").map((c) => c[0])).toEqual(["wr", "pod", "t5"]);
    expect(plCols("all").map((c) => c[0])).toEqual(["wr", "pod", "t5", "maps"]);
  });
});
