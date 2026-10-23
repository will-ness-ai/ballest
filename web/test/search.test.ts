// The site search's rules (lib/search.ts): what a query finds in each kind, in what order,
// how the results are grouped under the filter chips, and the jump-to links of an empty field.
import { describe, expect, test } from "vitest";

import {
  jumpsOf,
  marked,
  resultsOf,
  searchAll,
  searchTerm,
  type SearchSources,
} from "../lib/search";
import type { MapCard } from "../lib/workshop";

let n = 0;
const card = (o: Partial<MapCard> = {}): MapCard => ({
  pfid: String(1000 + n++),
  title: "Map " + String(n),
  creator: "Maker",
  cid: "76561199000000001",
  preview: null,
  created: 0,
  author: 20,
  entryCount: 10,
  sessions: 10,
  top3: [["76561199000000002", "Rae", 1_500_000]],
  gap13: null,
  crowd: 1,
  authorBeaten: 0,
  ...o,
});

const none: SearchSources = {
  players: [],
  cards: [],
  campaigns: [],
  boards: [],
  dailies: [],
  prefabs: [],
};

const titles = (s: Partial<SearchSources>, q: string, kind: string) =>
  searchAll(q, { ...none, ...s })
    .hits.filter((h) => h.kind === kind)
    .map((h) => h.title);

describe("a query's hits", () => {
  test("rank an exact name, then one that starts with it, a word that does, then a contains", () => {
    const cards = [
      card({ title: "Unsolved", entryCount: 900 }),
      card({ title: "Big Solar", entryCount: 500 }),
      card({ title: "Solar Trials", entryCount: 100 }),
      card({ title: "Solar", entryCount: 1 }),
    ];
    expect(titles({ cards }, "solar", "maps")).toEqual(["Solar", "Solar Trials", "Big Solar"]);
    // two that start with it go by runs; "sol" inside a word comes last, though it has the most
    expect(titles({ cards }, "sol", "maps")).toEqual([
      "Solar Trials",
      "Solar",
      "Big Solar",
      "Unsolved",
    ]);
  });

  test("find a Map by its maker's name too, after the Maps named by it", () => {
    const cards = [
      card({ title: "Cliffs", creator: "Rocky Road", entryCount: 900 }),
      card({ title: "Rocky Alpine", creator: "Someone", entryCount: 1 }),
    ];
    expect(titles({ cards }, "rocky", "maps")).toEqual(["Rocky Alpine", "Cliffs"]);
  });
});

const P1 = "76561199000000001",
  P2 = "76561199000000002",
  P3 = "76561199000000003";

describe("players and makers", () => {
  test("a player links to their page, and a maker says how many Maps they made", () => {
    const { hits } = searchAll("rae", {
      ...none,
      players: [{ steamId: P1, persona: "Rolling Rae", avatar: null }],
      cards: [card({ creator: "Rolling Rae", cid: P1 }), card({ creator: "Rolling Rae", cid: P1 })],
    });
    expect(hits.filter((h) => h.kind === "people")).toEqual([
      expect.objectContaining({
        href: "/player/" + P1,
        title: "Rolling Rae",
        meta: "Player · made 2 Maps",
        tag: "Maker",
        who: { steamId: P1, persona: "Rolling Rae", avatar: null },
      }),
    ]);
  });

  test("a maker with no times links to their Made tab", () => {
    const { hits } = searchAll("wright", {
      ...none,
      cards: [card({ creator: "Mapwright", cid: P2 })],
    });
    expect(hits.filter((h) => h.kind === "people")).toEqual([
      expect.objectContaining({ href: `/player/${P2}/made`, meta: "Made 1 Map", tag: "Maker" }),
    ]);
  });

  test("a maker the Workshop names without a Steam ID has no page to find", () => {
    const { hits } = searchAll("anon", { ...none, cards: [card({ creator: "Anon", cid: null })] });
    expect(hits.filter((h) => h.kind === "people")).toEqual([]);
  });

  test("the exact name first, and among equals the one who made more Maps", () => {
    const { hits } = searchAll("ed", {
      ...none,
      players: [
        { steamId: P1, persona: "Steady Ed", avatar: null },
        { steamId: P2, persona: "Edwin", avatar: null },
        { steamId: P3, persona: "Ed", avatar: null },
      ],
      cards: [card({ creator: "Steady Ed", cid: P1 })],
    });
    expect(hits.filter((h) => h.kind === "people").map((h) => h.title)).toEqual([
      "Ed",
      "Edwin",
      "Steady Ed",
    ]);
    const { hits: words } = searchAll("e", {
      ...none,
      players: [
        { steamId: P2, persona: "Ella", avatar: null },
        { steamId: P1, persona: "Eddy", avatar: null },
      ],
      cards: [card({ creator: "Eddy", cid: P1 })],
    });
    expect(words.filter((h) => h.kind === "people").map((h) => h.title)).toEqual(["Eddy", "Ella"]);
  });
});

const kind = (q: string, s: Partial<SearchSources>, k: string) =>
  searchAll(q, { ...none, ...s }).hits.filter((h) => h.kind === k);

describe("the other kinds", () => {
  const solar = {
    slug: "solar-trials",
    title: "Solar Trials",
    creator: "Tenpin",
    maps: 9,
    players: 3,
    preview: "https://images.example.invalid/mercury.jpg",
  };

  test("a Campaign by its name or its maker", () => {
    expect(kind("solar", { campaigns: [solar] }, "campaigns")).toEqual([
      expect.objectContaining({
        href: "/campaign/solar-trials",
        title: "Solar Trials",
        meta: "by Tenpin · 9 Maps · 3 players",
        img: solar.preview,
      }),
    ]);
    expect(kind("tenpin", { campaigns: [solar] }, "campaigns")).toHaveLength(1);
  });

  const board = (name: string, group: string, display: string, entryCount = 5) => ({
    name,
    group,
    tier: null,
    display,
    entryCount,
  });

  test("a Track by its number, the one numbered just that first", () => {
    const boards = [
      board("Map_Track19", "Season 1", "08"),
      board("Map_Track_S2_Downhill", "Season 2", "08 Downhill", 900),
      board("Map_Track13", "Season 1", "01"),
    ];
    expect(kind("08", { boards }, "tracks")).toEqual([
      expect.objectContaining({
        href: "/board/Map_Track19",
        title: "Season 1 · 08",
        img: "/circuit/Map_Track19.webp",
      }),
      expect.objectContaining({ title: "Season 2 · 08 Downhill", meta: "900 players" }),
    ]);
    expect(kind("downhill", { boards }, "tracks").map((h) => h.title)).toEqual([
      "Season 2 · 08 Downhill",
    ]);
  });

  const daily = (date: string, title: string, entryCount = 4) => ({
    date,
    pfid: "9000000001",
    title,
    preview: null,
    startsAt: date + "T01:00:00Z",
    endsAt: date + "T01:00:00Z",
    final: true,
    entryCount,
    winner: null,
  });

  test("a Daily by its Map's title or its date", () => {
    const dailies = [daily("2026-08-29", "Marble Run"), daily("2026-08-30", "Loop de Loop")];
    expect(kind("2026-08-30", { dailies }, "dailies")).toEqual([
      expect.objectContaining({
        href: "/daily/2026-08-30",
        title: "Loop de Loop",
        meta: "2026-08-30 · 4 players",
      }),
    ]);
    expect(kind("marble", { dailies }, "dailies").map((h) => h.href)).toEqual([
      "/daily/2026-08-29",
    ]);
    // equal matches with as many players: the newest first
    expect(kind("2026-08", { dailies }, "dailies").map((h) => h.href)).toEqual([
      "/daily/2026-08-30",
      "/daily/2026-08-29",
    ]);
  });

  test("a Prefab by its name or a tag", () => {
    const prefabs = [
      {
        slug: "twin-cubes",
        name: "Twin cubes",
        tags: ["Obstacle"],
        pieces: 2,
        favorites: 0,
        uploader: { name: "Rolling Rae" },
      },
    ];
    expect(kind("obstacle", { prefabs }, "prefabs")).toEqual([
      expect.objectContaining({
        href: "/prefab/twin-cubes",
        title: "Twin cubes",
        meta: "by Rolling Rae · 2 pieces",
        tag: "Prefab",
      }),
    ]);
    expect(kind("twin", { prefabs }, "prefabs")).toHaveLength(1);
  });
});

describe("the query", () => {
  test("is trimmed, lowercased and cut to 64 characters; nothing typed is no search", () => {
    expect(searchTerm("  Rolling RAE ")).toBe("rolling rae");
    expect(searchTerm("x".repeat(100))).toBe("x".repeat(64));
    expect(searchTerm("   ")).toBe("");
    expect(searchTerm(null)).toBe("");
  });

  test("is picked out of a name wherever it falls, whatever its case", () => {
    expect(marked("Rolling Rae", "rae")).toEqual(["Rolling ", "Rae", ""]);
    expect(marked("Rolling Rae", "nope")).toEqual(["Rolling Rae", "", ""]);
  });
});

describe("the results under the chips", () => {
  const sources = (): Partial<SearchSources> => ({
    players: [{ steamId: P1, persona: "Sol Badguy", avatar: null }],
    cards: Array.from({ length: 14 }, (_, i) => card({ title: "Solar " + String(i) })),
    campaigns: [
      {
        slug: "solar-trials",
        title: "Solar Trials",
        creator: "T",
        maps: 9,
        players: 3,
        preview: null,
      },
    ],
  });

  test("an answer carries ten of a kind at most, and counts every Map that matched", () => {
    const a = searchAll("sol", { ...none, ...sources() });
    expect(a.hits.filter((h) => h.kind === "maps")).toHaveLength(10);
    expect(a.mapTotal).toBe(14);
  });

  test("All shows three of each kind, best kind first, and a chip for each with its count", () => {
    const r = resultsOf(searchAll("sol", { ...none, ...sources() }), null);
    expect(r.chips).toEqual([
      { kind: null, label: "All", count: null, on: true },
      { kind: "people", label: "Players", count: 1, on: false },
      { kind: "campaigns", label: "Campaigns", count: 1, on: false },
      // the Maps chip counts every Map that matched, not only the ten carried
      { kind: "maps", label: "Maps", count: 14, on: false },
    ]);
    expect(r.groups.map((g) => [g.kind, g.heading, g.hits.length])).toEqual([
      ["people", "Players and makers", 1],
      ["campaigns", "Campaigns", 1],
      ["maps", "Maps", 3],
    ]);
    expect(r.groups[2].more).toEqual({ total: 14, href: "/maps?q=sol" });
  });

  test("a chip shows every hit of its kind it carries, with no heading", () => {
    const r = resultsOf(searchAll("sol", { ...none, ...sources() }), "maps");
    expect(r.chips.find((c) => c.on)?.kind).toBe("maps");
    expect(r.groups.map((g) => [g.kind, g.heading, g.hits.length])).toEqual([["maps", null, 10]]);
    expect(r.groups[0].more).toEqual({ total: 14, href: "/maps?q=sol" });
  });

  test("no link to All maps when every Map that matched is shown", () => {
    const r = resultsOf(searchAll("solar 13", { ...none, ...sources() }), null);
    expect(r.groups.find((g) => g.kind === "maps")?.more).toBeNull();
  });

  test("nothing found is no chips and no groups", () => {
    const r = resultsOf(searchAll("zzz", { ...none, ...sources() }), null);
    expect(r).toEqual({ chips: [], groups: [] });
  });
});

describe("an empty field's jump-to links", () => {
  const camp = (slug: string, players: number) => ({
    slug,
    title: slug.toUpperCase(),
    players,
    preview: "https://images.example.invalid/" + slug + ".jpg",
  });

  test("today's Daily, the newest Circuit season, then the two most played Campaigns", () => {
    const jumps = jumpsOf({
      dailies: [
        { date: "2026-08-31", title: "Gone Gully", preview: null, final: true, entryCount: 3 },
        { date: "2026-09-01", title: "Fresh Fields", preview: null, final: false, entryCount: 2 },
      ],
      seasons: [
        { group: "Season 2", overall: "OverallLeaderboard_EASeason2", players: 4 },
        { group: "Season 1", overall: "OverallLeaderboard_S1Current", players: 9 },
      ],
      // the pinned one listed first, though it has the fewest players
      campaigns: [camp("pinned", 1), camp("small", 2), camp("big", 30)],
    });
    expect(jumps.map((j) => [j.kind, j.href, j.title, j.meta])).toEqual([
      ["dailies", "/daily", "Fresh Fields", "Today's Daily · 2 players"],
      ["tracks", "/board/OverallLeaderboard_EASeason2", "Season 2", "Circuit · 4 players"],
      ["campaigns", "/campaign/big", "BIG", "Campaign · 30 players"],
      ["campaigns", "/campaign/small", "SMALL", "Campaign · 2 players"],
    ]);
  });

  test("a final newest Daily is the latest, and a site with none of these has none", () => {
    const [d] = jumpsOf({
      dailies: [
        { date: "2026-08-31", title: "Gone Gully", preview: null, final: true, entryCount: 3 },
      ],
      seasons: [],
      campaigns: [],
    });
    expect(d.meta).toBe("Latest Daily · 3 players");
    expect(jumpsOf({ dailies: [], seasons: [], campaigns: [] })).toEqual([]);
  });
});
