// The site's queries (db/site.ts) against the tiny dataset; every expected value is worked
// out by hand from the comments in db/seed/datasets/tiny.ts.
import { desc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { entries, refreshes } from "../db/schema";
import { seed } from "../db/seed/harness";
import {
  boardPage,
  boardPlaces,
  boardScores,
  circuitCounts,
  freshness,
  derivedStandings,
  playerData,
  searchPlayers,
  standings,
  trackPodiums,
  workshopMaps,
} from "../db/site";
import { podiumTallies } from "../lib/podiums";
import { freshDb } from "./pg";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
});
afterAll(() => t.drop());

const ranks = async (name: string) =>
  (await boardPage(t.db, name, { count: 100 })).rows.map((r) => [r.steamId, r.score]);

describe("Steam's boards", () => {
  test("a time board ranks fastest first, equal times lower Steam ID first", async () => {
    expect(await ranks("Map_Track13")).toEqual([
      [p(1), 1_013_307],
      [p(2), 1_019_884],
      [p(5), 1_019_884],
      [p(4), 1_100_000],
      [p(7), 1_100_000],
      [p(6), 1_200_000],
    ]);
    expect(await ranks("Map_Track15")).toEqual([
      [p(2), 1_800_000],
      [p(1), 1_900_000],
      [p(8), 1_900_000],
    ]);
  });

  test("a points board ranks most first, equal points higher Steam ID first", async () => {
    expect(await ranks("OverallLeaderboard_EASeason2")).toEqual([
      [p(3), 1450],
      [p(1), 1450],
      [p(2), 1200],
      [p(8), 300],
    ]);
  });

  test("a row carries its persona, avatar and the score one place up", async () => {
    const page = await boardPage(t.db, "Map_Track13", { count: 3 });
    expect(page.total).toBe(6);
    expect(page.rows[0]).toEqual({
      rank: 1,
      steamId: p(1),
      persona: "Rolling Rae",
      avatar: "https://avatars.example.invalid/1_medium.jpg",
      score: 1_013_307,
      ahead: null,
      seasons: null,
    });
    expect(page.rows.map((r) => r.ahead)).toEqual([null, 1_013_307, 1_019_884]);
  });

  test("a page starts where it is asked to", async () => {
    const page = await boardPage(t.db, "Map_Track13", { from: 4, count: 10 });
    expect(page.rows.map((r) => [r.rank, r.steamId])).toEqual([
      [5, p(7)],
      [6, p(6)],
    ]);
    expect(page.total).toBe(6);
  });

  test("a search keeps each row's real rank and interval", async () => {
    const page = await boardPage(t.db, "Map_Track13", { q: "ED" });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ rank: 5, steamId: p(7), ahead: 1_100_000 });
    const byId = await boardPage(t.db, "Map_Track13", { q: p(6) });
    expect(byId.rows.map((r) => r.rank)).toEqual([6]);
    const none = await boardPage(t.db, "Map_Track13", { q: "%" });
    expect(none).toEqual({ total: 0, rows: [] });
  });

  test("where given players stand on a board, leaving out who isn't on it", async () => {
    expect(await boardPlaces(t.db, "Map_Track13", [p(5), p(3), p(6)])).toEqual({
      [p(5)]: { rank: 3, score: 1_019_884 },
      [p(6)]: { rank: 6, score: 1_200_000 },
    });
    expect(await boardPlaces(t.db, "OverallLeaderboard_S1Current", [p(8)])).toEqual({
      [p(8)]: { rank: 4, score: 13333 },
    });
    expect(await boardPlaces(t.db, "Map_Track13", [])).toEqual({});
  });

  test("a board's scores in rank order", async () => {
    expect(await boardScores(t.db, "Workshop_9000000001")).toEqual([
      4_200_000, 4_800_000, 5_000_000,
    ]);
  });
});

describe("the derived boards", () => {
  test("Season 1 Current adds up each player's Track points", async () => {
    // Track 13 pays 40000, 20000, 13333, 10000, 8000, 6666; Track 15 40000, 20000, 13333.
    // Equal totals go by the first Track a player is on, then their place there.
    expect(await ranks("OverallLeaderboard_S1Current")).toEqual([
      [p(1), 60000],
      [p(2), 60000],
      [p(5), 13333],
      [p(8), 13333],
      [p(4), 10000],
      [p(7), 8000],
      [p(6), 6666],
    ]);
  });

  test("All Seasons adds Season 1 Current to Season 2 and keeps the parts", async () => {
    const page = await boardPage(t.db, "OverallLeaderboard_AllSeasons", { count: 100 });
    expect(page.rows.map((r) => [r.steamId, r.score])).toEqual([
      [p(1), 61450],
      [p(2), 61200],
      [p(8), 13633],
      [p(5), 13333],
      [p(4), 10000],
      [p(7), 8000],
      [p(6), 6666],
      [p(3), 1450],
    ]);
    expect(page.rows[0].seasons).toEqual({ "Season 1": 60000, "Season 2": 1450 });
    expect(page.rows[7].seasons).toEqual({ "Season 2": 1450 });
  });

  test("All Seasons puts equal totals in Season 1's order, then Season 2's", async () => {
    // p(9) joins Season 2 on 13633, p(8)'s total (13333 + 300): p(8) is on Season 1
    // Current, so goes first, as the collector met them.
    const own = await freshDb();
    try {
      await seed(own.db, "tiny");
      const [{ id }] = await own.db
        .select({ id: refreshes.id })
        .from(refreshes)
        .orderBy(desc(refreshes.id))
        .limit(1);
      await own.db.insert(entries).values({
        board: "OverallLeaderboard_EASeason2",
        steamId: p(9),
        score: 13633,
        ugcId: "9000000009013633",
        firstSeenRefresh: id,
        lastSeenRefresh: id,
      });
      const page = await boardPage(own.db, "OverallLeaderboard_AllSeasons", { count: 100 });
      expect(page.rows.slice(2, 5).map((r) => [r.steamId, r.score])).toEqual([
        [p(8), 13633],
        [p(9), 13633],
        [p(5), 13333],
      ]);
    } finally {
      await own.drop();
    }
  });

  test("every Circuit board counts its players", async () => {
    const counts = await circuitCounts(t.db);
    expect(counts).toMatchObject({
      Map_Track13: 6,
      Map_Track15: 3,
      OverallLeaderboard_EASeason2: 4,
      OverallLeaderboard_S1Current: 7,
      OverallLeaderboard_AllSeasons: 8,
    });
  });
});

describe("podiums", () => {
  test("a season's tally counts only its Tracks with placings, equal counts sharing a rank", async () => {
    const tallies = podiumTallies(await trackPodiums(t.db));
    expect(tallies.map((s) => [s.group, s.tracks])).toEqual([["Season 1", 2]]);
    expect(tallies[0].players.map((x) => [x.steamId, x.rank, x.gold, x.silver, x.bronze])).toEqual([
      [p(1), 1, 1, 1, 0],
      [p(2), 1, 1, 1, 0],
      [p(5), 3, 0, 0, 1],
      [p(8), 3, 0, 0, 1],
    ]);
    expect(tallies[0].players[0].finishes).toEqual([
      { track: "01", rank: 1, score: 1_013_307 },
      { track: "02", rank: 2, score: 1_900_000 },
    ]);
  });
});

describe("the Workshop", () => {
  test("lists the Maps the Workshop still carries, newest first, with their figures", async () => {
    const maps = await workshopMaps(t.db);
    expect(maps.map((m) => m.pfid)).toEqual(["9000000002", "9000000001"]);
    expect(maps[1]).toEqual({
      pfid: "9000000001",
      name: "Workshop_9000000001",
      title: "Marble Run",
      creator: "Tenpin",
      cid: p(10),
      preview: "https://images.example.invalid/marble-run.jpg",
      created: Date.parse("2026-08-30T12:00:00Z") / 1000,
      medals: [60, 45, 40, 38.5],
      entryCount: 3,
      sessions: 7,
      subs: 9,
      top3: [
        [p(9), "Ninth", 4_200_000],
        [p(10), "Tenpin", 4_800_000],
        [p(1), "Rolling Rae", 5_000_000],
      ],
      gap13: 800_000,
      crowd: 1,
      authorBeaten: 0,
    });
    expect(maps[0]).toMatchObject({
      gap13: null,
      crowd: 1,
      top3: [
        [p(10), "Tenpin", 6_100_000],
        [p(2), "Justy Sparks", 6_900_000],
      ],
    });
  });

  test("every listed Map was read in full by its oldest latest read", async () => {
    // Map B last read in R1 (R3's read failed); Map C is gone, so it doesn't count.
    expect(await freshness(t.db)).toEqual({
      refreshedAt: "2026-09-01T06:05:00.000Z",
      mapsReadBy: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe("a player", () => {
  test("their place on every board, derived ones included", async () => {
    const data = await playerData(t.db, p(1), await derivedStandings(t.db));
    expect(data?.profile).toEqual({
      steamId: p(1),
      persona: "Rolling Rae",
      avatar: "https://avatars.example.invalid/1_medium.jpg",
      profileUrl: `https://steamcommunity.com/profiles/${p(1)}/`,
    });
    expect(data?.finishes.map((f) => [f.board, f.rank, f.score, f.lead, f.field])).toEqual([
      ["Map_Track13", 1, 1_013_307, 1_013_307, 6],
      ["Map_Track15", 2, 1_900_000, 1_800_000, 3],
      ["OverallLeaderboard_AllSeasons", 1, 61450, 61450, 8],
      ["OverallLeaderboard_EASeason2", 2, 1450, 1450, 4],
      ["OverallLeaderboard_S1Current", 1, 60000, 60000, 7],
      ["Workshop_9000000001", 3, 5_000_000, 4_200_000, 3],
    ]);
  });

  test("a Steam ID on no board is null", async () => {
    expect(await playerData(t.db, p(99), {})).toBeNull();
  });
});

describe("the Players counts", () => {
  test("Circuit and Workshop records, podiums and top 5s over the listed Maps", async () => {
    const s = await standings(t.db);
    expect(s.tracks).toBe(20);
    expect(s.maps).toBe(2);
    expect(s.players).toEqual([
      [p(1), "Rolling Rae", 1, 0, 2, 1, 2, 1, 1],
      [p(2), "Justy Sparks", 1, 0, 2, 1, 2, 1, 1],
      [p(4), "Slowpoke", 0, 0, 0, 0, 1, 0, 0],
      [p(5), "Tie Breaker", 0, 0, 1, 0, 1, 0, 0],
      [p(7), "Steady Ed", 0, 0, 0, 0, 1, 0, 0],
      [p(8), "Points Pat", 0, 0, 1, 0, 1, 0, 0],
      [p(9), "Ninth", 0, 1, 0, 1, 0, 1, 1],
      [p(10), "Tenpin", 0, 1, 0, 2, 0, 2, 2],
    ]);
  });
});

describe("the player search", () => {
  test("names that start with the text come first", async () => {
    const hits = await searchPlayers(t.db, "Po");
    expect(hits.map((h) => h.persona)).toEqual(["Points Pat", "Slowpoke"]);
  });

  test("leaves out the player being compared against", async () => {
    const hits = await searchPlayers(t.db, "pa", { except: p(2) });
    expect(hits.map((h) => h.steamId)).toEqual([p(8)]);
  });
});
