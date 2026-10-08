// The Workshop views' rules (lib/workshop.ts): which Maps the homepage leaves out, the
// shelves and picks, the Refine panel's filters, and the search.
import { describe, expect, test } from "vitest";

import {
  HIDDEN,
  SHELVES,
  SORTS,
  filteredMaps,
  onShelf,
  picks,
  refineFor,
  reportHref,
  sameRefine,
  searchMaps,
  shelfMaps,
  whyOf,
  type MapCard,
} from "../lib/workshop";

const DAY = 86400;
const NOW = 1_800_000_000 * 1000;
const at = (daysAgo: number) => NOW / 1000 - daysAgo * DAY;

let n = 0;
const map = (o: Partial<MapCard> = {}): MapCard => ({
  pfid: String(1000 + n++),
  title: "Map " + String(n),
  creator: "Maker",
  cid: "76561199000000001",
  preview: null,
  created: at(30),
  author: 20,
  entryCount: 10,
  sessions: 10,
  top3: [["76561199000000002", "Rae", 1_500_000]],
  gap13: null,
  crowd: 1,
  authorBeaten: 0,
  ...o,
});

const hiddenPfid = Object.keys(HIDDEN)[0];

describe("the homepage", () => {
  test("leaves a reported Map off the shelves and the carousel, but not the search", () => {
    const hidden = map({ pfid: hiddenPfid, title: "Broken", sessions: 999 });
    const maps = [hidden, map({ sessions: 5 })];
    expect(shelfMaps(maps, SHELVES[0]).map((m) => m.pfid)).not.toContain(hiddenPfid);
    expect(picks(maps).map((p) => p.m.pfid)).not.toContain(hiddenPfid);
    expect(searchMaps(maps, "broken").map((m) => m.pfid)).toEqual([hiddenPfid]);
  });

  test("picks five different Maps, each for its own reason", () => {
    const maps = Array.from({ length: 8 }, (_, i) =>
      map({ sessions: i, entryCount: 8 - i, created: at(i), gap13: i === 3 ? 5 : null }),
    );
    const p = picks(maps);
    expect(p.map((x) => x.label)).toEqual([
      "Most played",
      "Newest",
      "Most runs",
      "Barely played",
      "Tightest top three",
    ]);
    expect(new Set(p.map((x) => x.m.pfid)).size).toBe(5);
    expect(whyOf(p[1], NOW)).toBe("published today");
  });

  test("New this week keeps only the Maps published in the last seven days", () => {
    const week = SHELVES.find((d) => d.week);
    if (!week) throw new Error("no week shelf");
    const maps = [map({ created: at(2) }), map({ created: at(8) })];
    const shelf = shelfMaps(maps, week);
    expect(shelf).toHaveLength(2);
    expect(onShelf(shelf, week, NOW).map((m) => m.created)).toEqual([at(2)]);
  });

  test("a shelf that is about a figure leaves out the Maps without it", () => {
    const tight = SHELVES.find((d) => d.sort === "tight");
    if (!tight) throw new Error("no tight shelf");
    const maps = [map({ gap13: null }), map({ gap13: 300 })];
    expect(shelfMaps(maps, tight).map((m) => m.gap13)).toEqual([300]);
  });
});

describe("All maps", () => {
  test("a view's preset, and whether the panel still matches it", () => {
    expect(refineFor("new")).toEqual({
      len: "any",
      age: "week",
      author: "any",
      runs: "any",
      sort: "new",
    });
    expect(sameRefine(refineFor(null), refineFor("all"))).toBe(true);
    expect(sameRefine(refineFor("new"), refineFor("all"))).toBe(false);
  });

  test("filters narrow the list and the sort orders it", () => {
    const maps = [
      map({ author: 10, entryCount: 5 }),
      map({ author: 30, entryCount: 50 }),
      map({ author: 50, entryCount: 500, authorBeaten: 3 }),
    ];
    const f = refineFor("all");
    expect(filteredMaps(maps, f, NOW).map((m) => m.entryCount)).toEqual([500, 50, 5]);
    expect(filteredMaps(maps, { ...f, len: "short" }, NOW).map((m) => m.author)).toEqual([10]);
    expect(filteredMaps(maps, { ...f, author: "unbeaten", runs: "some" }, NOW)).toHaveLength(1);
    expect(filteredMaps(maps, { ...f, sort: "short" }, NOW).map((m) => m.author)).toEqual([
      10, 30, 50,
    ]);
  });

  test("each sort's figure", () => {
    const m = map({ author: 20, top3: [["1", "a", 1_500_000]], gap13: 12_345 });
    expect(SORTS.tight.stat(m, NOW)).toBe("1st to 3rd 0.123s");
    expect(SORTS.under.stat(m, NOW)).toBe("5.000s under");
    expect(SORTS.new.stat({ ...m, created: at(3) }, NOW)).toBe("3 days ago");
    expect(SORTS.under.stat({ ...m, author: 10 }, NOW)).toBe("not beaten");
  });
});

test("the report link names the Map and links its page", () => {
  const u = new URL(reportHref({ title: "Loop & Drop", pfid: "123" }));
  expect(u.searchParams.get("title")).toBe("Hide map: Loop & Drop (123)");
  expect(u.searchParams.get("body")).toContain("https://ballestrecords.com/map/123");
});
