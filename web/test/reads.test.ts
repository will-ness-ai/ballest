// The read layer's queries against the tiny dataset; every expected value comes from the
// comments in db/seed/datasets/tiny.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { boardStandings, mapList, playerEntries, scoreHistory } from "../db/reads";
import { seed } from "../db/seed/harness";
import { freshDb } from "./pg";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
});
afterAll(() => t.drop());

describe("a board's current Entries", () => {
  test("a time board ranks fastest first, ties by first seen then Steam ID", async () => {
    const board = await boardStandings(t.db, "Map_Track13");
    expect(board).toMatchObject({
      name: "Map_Track13",
      kind: "track",
      season: "Season 1",
      display: "01",
      scoresPoints: false,
    });
    expect(board?.entries.map((e) => [e.rank, e.steamId, e.score])).toEqual([
      [1, p(1), 1_013_307],
      [2, p(2), 1_019_884],
      [3, p(5), 1_019_884],
      [4, p(4), 1_100_000],
      [5, p(7), 1_100_000],
      [6, p(6), 1_200_000],
    ]);
    expect(board?.entries[0]).toMatchObject({
      persona: "Rolling Rae",
      avatar: "https://avatars.example.invalid/1_medium.jpg",
      profileUrl: `https://steamcommunity.com/profiles/${p(1)}/`,
    });
    expect(board?.entries[1].persona).toBe("Justy Sparks");
  });

  test("a points board ranks highest first", async () => {
    const board = await boardStandings(t.db, "OverallLeaderboard_EASeason2");
    expect(board?.entries.map((e) => [e.rank, e.steamId, e.score])).toEqual([
      [1, p(1), 1450],
      [2, p(3), 1450],
      [3, p(2), 1200],
      [4, p(8), 300],
    ]);
  });

  test("a Map whose last read failed keeps the Entries it last saw", async () => {
    const board = await boardStandings(t.db, "Workshop_9000000002");
    expect(board?.entries.map((e) => e.steamId)).toEqual([p(10), p(2)]);
  });

  test("an unknown board is null", async () => {
    expect(await boardStandings(t.db, "Map_Nope")).toBeNull();
  });
});

describe("a player's current Entries", () => {
  test("every board they are on, with their rank there", async () => {
    const player = await playerEntries(t.db, p(1));
    expect(player).toMatchObject({ steamId: p(1), persona: "Rolling Rae" });
    expect(player?.entries.map((e) => [e.board, e.rank, e.score])).toEqual([
      ["Map_Track13", 1, 1_013_307],
      ["OverallLeaderboard_EASeason2", 1, 1450],
      ["Workshop_9000000001", 3, 5_000_000],
    ]);
    expect(player?.entries[2]).toMatchObject({
      display: "Marble Run",
      kind: "map",
      season: null,
      scoresPoints: false,
    });
  });

  test("a closed Entry is not current, and ranks count only open Entries", async () => {
    const player = await playerEntries(t.db, p(3));
    expect(player?.entries.map((e) => [e.board, e.rank])).toEqual([
      ["OverallLeaderboard_EASeason2", 2],
    ]);
    const tenpin = await playerEntries(t.db, p(10));
    expect(tenpin?.entries.map((e) => [e.board, e.rank])).toEqual([
      ["Workshop_9000000001", 2],
      ["Workshop_9000000002", 1],
    ]);
  });

  test("an unknown player is null", async () => {
    expect(await playerEntries(t.db, "76561199999999999")).toBeNull();
  });
});

describe("a board's Score history", () => {
  const r1 = "2026-09-01T00:00:00.000Z";
  const r2 = "2026-09-01T03:00:00.000Z";
  const r3 = "2026-09-01T06:00:00.000Z";

  test("every Entry, open and closed, in the order they were first seen", async () => {
    const history = await scoreHistory(t.db, "Map_Track13");
    expect(
      history?.map((e) => [e.steamId, e.score, e.firstSeenAt, e.lastSeenAt, e.closedAt]),
    ).toEqual([
      [p(1), 1_050_000, r1, r1, r2],
      [p(2), 1_019_884, r1, r3, null],
      [p(3), 1_023_276, r1, r2, r3],
      [p(4), 1_100_000, r1, r3, null],
      [p(7), 1_100_000, r1, r3, null],
      [p(1), 1_013_307, r2, r3, null],
      [p(5), 1_019_884, r2, r3, null],
      [p(6), 1_200_000, r3, r3, null],
    ]);
    expect(history?.[0].persona).toBe("Rolling Rae");
  });

  test("an unknown board is null", async () => {
    expect(await scoreHistory(t.db, "Map_Nope")).toBeNull();
  });
});

describe("the Map list", () => {
  test("every Map with its latest metadata, newest first", async () => {
    expect(await mapList(t.db)).toEqual([
      {
        pfid: "9000000002",
        board: "Workshop_9000000002",
        creatorSteamId: p(9),
        createdAt: "2026-08-31T12:00:00.000Z",
        title: "Loop de Loop",
        creator: "Ninth",
        preview: null,
        medals: [90, 70, 62, 58.25],
        sessions: 2,
        subs: 4,
        entryCount: 2,
      },
      {
        pfid: "9000000001",
        board: "Workshop_9000000001",
        creatorSteamId: p(10),
        createdAt: "2026-08-30T12:00:00.000Z",
        title: "Marble Run",
        creator: "Tenpin",
        preview: "https://images.example.invalid/marble-run.jpg",
        medals: [60, 45, 40, 38.5],
        sessions: 7,
        subs: 9,
        entryCount: 3,
      },
    ]);
  });
});
