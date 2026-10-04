// A handful of boards with three Refreshes of Score history behind them: an improvement
// on each kind of board, an Entry closed when its player left a board, equal scores on a
// time board and on a points board, a Map not read in a Refresh, one whose read failed and
// one gone from the Workshop, two Season 1 Tracks to add up, and a persona change. The read
// layer's tests (test/site.test.ts, test/reads.test.ts) take their expected values from
// the comments here. Every player and Map is made up.
import {
  boardReads,
  boards,
  entries,
  mapHistory,
  maps,
  personaHistory,
  players,
  refreshes,
} from "../../schema";
import type { Dataset } from "./types";

const TRACK = "Map_Track13";
const TRACK2 = "Map_Track15";
const OVERALL = "OverallLeaderboard_EASeason2";
const MAP_A = "Workshop_9000000001";
const MAP_B = "Workshop_9000000002";
const MAP_C = "Workshop_9000000003";

// p(1) .. p(10)
const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

export const tiny: Dataset = {
  description: "6 boards (2 Tracks, an Overall board, 3 Maps), 10 players, 3 Refreshes",
  seed: async (tx) => {
    const [r1, r2, r3] = (
      await tx
        .insert(refreshes)
        .values(
          ["2026-09-01T00:00:00Z", "2026-09-01T03:00:00Z", "2026-09-01T06:00:00Z"].map((t) => ({
            startedAt: new Date(t),
            finishedAt: new Date(new Date(t).getTime() + 5 * 60_000),
            source: "collector" as const,
          })),
        )
        .returning({ id: refreshes.id })
    ).map((r) => r.id);

    await tx.insert(boards).values([
      {
        name: TRACK,
        kind: "track",
        season: "Season 1",
        display: "01",
        leaderboardId: 17800617,
        scoresPoints: false,
      },
      {
        name: TRACK2,
        kind: "track",
        season: "Season 1",
        display: "02",
        leaderboardId: 17800873,
        scoresPoints: false,
      },
      {
        name: OVERALL,
        kind: "overall",
        season: "Season 2",
        display: "Overall",
        leaderboardId: 20484546,
        scoresPoints: true,
      },
      {
        name: MAP_A,
        kind: "map",
        display: "Marble Run",
        leaderboardId: 90000001,
        scoresPoints: false,
      },
      {
        name: MAP_B,
        kind: "map",
        display: "Loop de Loop",
        leaderboardId: 90000002,
        scoresPoints: false,
      },
      {
        name: MAP_C,
        kind: "map",
        display: "Gone Gully",
        leaderboardId: 90000003,
        scoresPoints: false,
      },
    ]);

    // R2 does not read the Maps; R3 reads Map A and fails to read Map B. Map C was read in
    // R1, then left the Workshop: R2's catalogue no longer lists it.
    await tx.insert(boardReads).values([
      { refreshId: r1, board: TRACK, ok: true, entryCount: 5 },
      { refreshId: r1, board: OVERALL, ok: true, entryCount: 3 },
      { refreshId: r1, board: MAP_A, ok: true, entryCount: 2 },
      { refreshId: r1, board: MAP_B, ok: true, entryCount: 2 },
      { refreshId: r1, board: MAP_C, ok: true, entryCount: 1 },
      { refreshId: r3, board: TRACK2, ok: true, entryCount: 3 },
      { refreshId: r2, board: TRACK, ok: true, entryCount: 6 },
      { refreshId: r2, board: OVERALL, ok: true, entryCount: 3 },
      { refreshId: r3, board: TRACK, ok: true, entryCount: 6 },
      { refreshId: r3, board: OVERALL, ok: true, entryCount: 4 },
      { refreshId: r3, board: MAP_A, ok: true, entryCount: 3 },
      { refreshId: r3, board: MAP_B, ok: false, entryCount: null },
    ]);

    const personas = [
      "Rolling Rae",
      "Justy Sparks", // was "Justy" in R1
      "Quickmarble",
      "Slowpoke",
      "Tie Breaker",
      "Newcomer",
      "Steady Ed",
      "Points Pat",
      "Ninth",
      "Tenpin",
    ];
    await tx.insert(players).values(
      personas.map((persona, i) => ({
        steamId: p(i + 1),
        persona,
        avatar: i % 3 === 2 ? null : `https://avatars.example.invalid/${String(i + 1)}_medium.jpg`,
        profileUrl: `https://steamcommunity.com/profiles/${p(i + 1)}/`,
      })),
    );
    const firstSeen = (n: number) => (n === 5 ? r2 : n === 6 ? r3 : r1);
    await tx.insert(personaHistory).values([
      { steamId: p(2), persona: "Justy", firstSeenRefresh: r1, lastSeenRefresh: r1 },
      ...personas.map((persona, i) => ({
        steamId: p(i + 1),
        persona,
        firstSeenRefresh: i === 1 ? r2 : firstSeen(i + 1),
        lastSeenRefresh: r3,
      })),
    ]);

    const e = (
      board: string,
      n: number,
      score: number,
      first: number,
      last: number,
      closed: number | null = null,
    ) => ({
      board,
      steamId: p(n),
      score,
      ugcId: `${String(9_000_000_000 + n)}${String(score)}`,
      firstSeenRefresh: first,
      lastSeenRefresh: last,
      closedRefresh: closed,
    });
    await tx.insert(entries).values([
      // Track: ranked p1 1013307, p2 1019884, p5 1019884 (tie, first seen later),
      // p4 1100000, p7 1100000 (tie, same first seen, higher Steam ID), p6 1200000.
      // p3 left the board in R3.
      e(TRACK, 1, 1_050_000, r1, r1, r2),
      e(TRACK, 1, 1_013_307, r2, r3),
      e(TRACK, 2, 1_019_884, r1, r3),
      e(TRACK, 3, 1_023_276, r1, r2, r3),
      e(TRACK, 4, 1_100_000, r1, r3),
      e(TRACK, 5, 1_019_884, r2, r3),
      e(TRACK, 6, 1_200_000, r3, r3),
      e(TRACK, 7, 1_100_000, r1, r3),
      // Track 2, read only in R3: p2 1800000, p1 1900000 and p8 1900000 (a tie on a time
      // board: the lower Steam ID first).
      e(TRACK2, 2, 1_800_000, r3, r3),
      e(TRACK2, 8, 1_900_000, r3, r3),
      e(TRACK2, 1, 1_900_000, r3, r3),
      // Overall, points, higher first: p3 1450 and p1 1450 (a tie on a points board: the
      // higher Steam ID first), p2 1200, p8 300.
      e(OVERALL, 1, 900, r1, r1, r2),
      e(OVERALL, 1, 1450, r2, r3),
      e(OVERALL, 2, 1200, r1, r3),
      e(OVERALL, 3, 1450, r3, r3),
      e(OVERALL, 8, 300, r1, r3),
      // Map A: p9 4200000 (improved in R3), p10 4800000, p1 5000000.
      e(MAP_A, 9, 4_500_000, r1, r1, r3),
      e(MAP_A, 9, 4_200_000, r3, r3),
      e(MAP_A, 10, 4_800_000, r1, r3),
      e(MAP_A, 1, 5_000_000, r3, r3),
      // Map B, last read successfully in R1: p10 6100000, p2 6900000.
      e(MAP_B, 10, 6_100_000, r1, r1),
      e(MAP_B, 2, 6_900_000, r1, r1),
      // Map C, gone from the Workshop after R1: its Entry stays open.
      e(MAP_C, 3, 3_000_000, r1, r1),
    ]);

    await tx.insert(maps).values([
      {
        pfid: "9000000001",
        board: MAP_A,
        creatorSteamId: p(10),
        createdAt: new Date("2026-08-30T12:00:00Z"),
      },
      {
        pfid: "9000000002",
        board: MAP_B,
        creatorSteamId: p(9),
        createdAt: new Date("2026-08-31T12:00:00Z"),
      },
      {
        pfid: "9000000003",
        board: MAP_C,
        creatorSteamId: p(3),
        createdAt: new Date("2026-08-29T12:00:00Z"),
      },
    ]);
    const marbleRun = {
      pfid: "9000000001",
      title: "Marble Run",
      creator: "Tenpin",
      preview: "https://images.example.invalid/marble-run.jpg",
      medals: [60, 45, 40, 38.5],
    };
    await tx.insert(mapHistory).values([
      // Map A's activity moved in R3: that row is its current one.
      {
        ...marbleRun,
        sessions: 3,
        subs: 5,
        entryCount: 2,
        firstSeenRefresh: r1,
        lastSeenRefresh: r1,
      },
      {
        ...marbleRun,
        sessions: 7,
        subs: 9,
        entryCount: 3,
        firstSeenRefresh: r3,
        lastSeenRefresh: r3,
      },
      {
        pfid: "9000000002",
        title: "Loop de Loop",
        creator: "Ninth",
        preview: null,
        medals: [90, 70, 62, 58.25],
        sessions: 2,
        subs: 4,
        entryCount: 2,
        firstSeenRefresh: r1,
        // every Refresh's catalogue lists it, though R2 and R3 read no runs from it
        lastSeenRefresh: r3,
      },
      {
        pfid: "9000000003",
        title: "Gone Gully",
        creator: "Quickmarble",
        preview: null,
        medals: [40, 30, 25, 22],
        sessions: 1,
        subs: 1,
        entryCount: 1,
        firstSeenRefresh: r1,
        lastSeenRefresh: r1,
      },
    ]);
  },
};
