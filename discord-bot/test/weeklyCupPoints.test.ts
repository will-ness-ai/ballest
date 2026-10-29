// The Weekly Cup's scoring (spec #353): the Circuit's place points on each Cup Map, ranked by
// time with ties sharing a place, no time scoring 0, the total deciding, and more Map wins
// settling a tie on it. The points are the site's own rule (web/lib/rules.ts), held to it here.
import { describe, expect, it } from "@effect/vitest";
import { trackPoints } from "../../web/lib/rules.js";
import { cupPoints, cupStandings } from "../src/weeklyCup/points.js";

const MAPS = [
  { pfid: "a", title: "Alpha" },
  { pfid: "b", title: "Bravo" },
  { pfid: "c", title: "Charlie" },
];

describe("the Cup's place points", () => {
  it("pays 40,000 for 1st, 20,000 for 2nd, ... 4,000 for 10th, then the game's curve", () => {
    expect([1, 2, 3, 4, 10, 11, 20, 100, 101].map(cupPoints)).toEqual([
      40000, 20000, 13333, 10000, 4000, 3618, 2800, 2000, 1890,
    ]);
  });

  it("is the site's trackPoints at every place", () => {
    for (let place = 1; place <= 5000; place++) expect(cupPoints(place)).toBe(trackPoints(place));
  });
});

describe("the Cup's standings", () => {
  it("ranks each Map by time, pays its places and totals them", () => {
    const s = cupStandings(MAPS, ["ann", "ben", "cat"], {
      a: { ann: 1000, ben: 2000, cat: 3000 },
      b: { ben: 1000, ann: 2000 },
      c: { cat: 500 },
    });
    expect(s.maps.map((m) => m.rows.map((r) => [r.discordId, r.rank, r.points]))).toEqual([
      [
        ["ann", 1, 40000],
        ["ben", 2, 20000],
        ["cat", 3, 13333],
      ],
      [
        ["ben", 1, 40000],
        ["ann", 2, 20000],
        ["cat", null, 0],
      ],
      [
        ["cat", 1, 40000],
        ["ann", null, 0],
        ["ben", null, 0],
      ],
    ]);
    // ann and ben level on 60,000 with a win each: they share 1st, in sign-up order.
    expect(s.overall.map((o) => [o.discordId, o.place, o.total, o.wins])).toEqual([
      ["ann", 1, 60000, 1],
      ["ben", 1, 60000, 1],
      ["cat", 3, 53333, 1],
    ]);
  });

  it("lets equal times share a place and its points", () => {
    const s = cupStandings(MAPS.slice(0, 1), ["ann", "ben", "cat"], {
      a: { ann: 1000, ben: 1000, cat: 1500 },
    });
    expect(s.maps[0]?.rows.map((r) => [r.discordId, r.rank, r.points])).toEqual([
      ["ann", 1, 40000],
      ["ben", 1, 40000],
      ["cat", 3, 13333],
    ]);
  });

  it("ranks by total first, whatever the wins", () => {
    const s = cupStandings(MAPS, ["ann", "ben", "cat"], {
      a: { ann: 1000, ben: 2000, cat: 3000 },
      b: { ann: 1000, ben: 2000, cat: 3000 },
      c: { ben: 1000, cat: 2000, ann: 3000 },
    });
    // ann 40,000 + 40,000 + 13,333; ben 20,000 + 20,000 + 40,000; cat 13,333 + 13,333 + 20,000.
    expect(s.overall.map((o) => [o.discordId, o.total, o.wins, o.place])).toEqual([
      ["ann", 93333, 2, 1],
      ["ben", 80000, 1, 2],
      ["cat", 46666, 0, 3],
    ]);
  });

  it("breaks an equal total by Map wins", () => {
    // ann wins one Map and misses two (40,000, 1 win); ben is 2nd on two (40,000, 0 wins).
    const s = cupStandings(MAPS, ["ben", "ann", "cat"], {
      a: { ann: 1000, ben: 2000 },
      b: { cat: 1000, ben: 2000 },
      c: { cat: 1000 },
    });
    const ann = s.overall.find((o) => o.discordId === "ann");
    const ben = s.overall.find((o) => o.discordId === "ben");
    expect([ann?.total, ann?.wins, ben?.total, ben?.wins]).toEqual([40000, 1, 40000, 0]);
    expect(s.overall.map((o) => o.discordId)).toEqual(["cat", "ann", "ben"]);
    expect(s.overall.map((o) => o.place)).toEqual([1, 2, 3]);
  });

  it("puts an Entrant with no time anywhere last, with 0", () => {
    const s = cupStandings(MAPS, ["ann", "ben"], { a: { ann: 1000 } });
    expect(s.overall.map((o) => [o.discordId, o.total, o.place])).toEqual([
      ["ann", 40000, 1],
      ["ben", 0, 2],
    ]);
  });
});
