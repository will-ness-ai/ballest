// A handful of boards with three Refreshes of Score history behind them: an improvement
// on each kind of board, an Entry closed when its player left a board, equal scores on a
// time board and on a points board, a Map not read in a Refresh, one whose read failed and
// one gone from the Workshop, two Season 1 Tracks to add up, a persona change, and four
// Dailies (three final, one live, a tie on a podium, a player who missed a day mid-run and
// a failed read), and a few runs' Ghosts read for their Skins, some with a profile. The
// read layer's tests (test/site.test.ts, test/reads.test.ts, test/board-route.test.ts) take
// their expected values from the comments here. Every player and Map is made up.
import {
  boardReads,
  boards,
  dailies,
  entries,
  ghosts,
  mapHistory,
  maps,
  personaHistory,
  players,
  refreshes,
} from "../../schema";
import type { Dataset } from "./types";

/* skins as a Ghost names them */
export const SKIN = {
  pink: "/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink",
  magma: "/Game/Art/Materials/Masters/M_LavaBall.M_LavaBall",
  cosmic:
    "/Game/Packs/Vefects/Stylized_Galaxy_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02",
  gold: "/Game/Art/M_GoldReal.M_GoldReal",
};
const HAT = "/Game/Art/Props/Player/CatEars/SM_CatEars_Combined.SM_CatEars_Combined";

const TRACK = "Map_Track13";
const TRACK2 = "Map_Track15";
const OVERALL = "OverallLeaderboard_EASeason2";
const MAP_A = "Workshop_9000000001";
const MAP_B = "Workshop_9000000002";
const MAP_C = "Workshop_9000000003";

// Dailies, each its own board named as the developers' API names it, on 01:00 to 01:00 UTC
// windows. 08-29 and 08-30 are final in R1; 08-31 closes at 09-01 01:00, between R1
// (00:00) and R2 (03:00), so R1 reads it live and R2 makes it final; 09-01 is live, read
// ok in R2, and R3's read of it failed.
const DAY1 = "ballest_v0_9000000001_Daily_20260829_aa000001";
const DAY2 = "ballest_v0_9000000002_Daily_20260830_aa000002";
const DAY3 = "ballest_v0_9000000003_Daily_20260831_aa000003";
const DAY4 = "ballest_v0_9000000004_Daily_20260901_aa000004";

// p(1) .. p(10)
const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

/* a Ghost's profile for a run of `seconds`: below 1, `bend` puts the run ahead early */
export const profile = (seconds: number, bend: number) =>
  Array.from({ length: 80 }, (_, i) => Math.round(seconds * ((i + 1) / 80) ** bend * 1000) / 1000);

export const tiny: Dataset = {
  description:
    "6 boards (2 Tracks, an Overall board, 3 Maps), 4 Dailies, 10 players, 3 Refreshes, 9 Ghosts",
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
      ...(
        [
          [DAY1, "Marble Run"],
          [DAY2, "Loop de Loop"],
          [DAY3, "Gone Gully"],
          [DAY4, "Fresh Fields"],
        ] as const
      ).map(([name, display], i) => ({
        name,
        kind: "daily" as const,
        display,
        leaderboardId: 91000001 + i,
        scoresPoints: false,
      })),
    ]);

    const day = (
      date: string,
      board: string,
      pfid: string,
      title: string,
      final: number | null,
    ) => {
      const start = new Date(`${date}T01:00:00Z`);
      return {
        date,
        board,
        pfid,
        title,
        startsAt: start,
        endsAt: new Date(start.getTime() + 24 * 3600_000),
        finalRefresh: final,
      };
    };
    await tx.insert(dailies).values([
      day("2026-08-29", DAY1, "9000000001", "Marble Run", r1),
      day("2026-08-30", DAY2, "9000000002", "Loop de Loop", r1),
      day("2026-08-31", DAY3, "9000000003", "Gone Gully", r2),
      // a Map no Workshop catalogue has listed: no picture and no Medals
      day("2026-09-01", DAY4, "9000000004", "Fresh Fields", null),
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
      { refreshId: r1, board: DAY1, ok: true, entryCount: 4 },
      { refreshId: r1, board: DAY2, ok: true, entryCount: 4 },
      { refreshId: r1, board: DAY3, ok: true, entryCount: 2 },
      { refreshId: r2, board: DAY3, ok: true, entryCount: 3 },
      { refreshId: r2, board: DAY4, ok: true, entryCount: 2 },
      { refreshId: r3, board: DAY4, ok: false, entryCount: null },
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
      // Daily 08-29 (Marble Run), final: p1 4100000, p2 4300000, p3 4350000, p4 5000000.
      e(DAY1, 1, 4_100_000, r1, r1),
      e(DAY1, 2, 4_300_000, r1, r1),
      e(DAY1, 3, 4_350_000, r1, r1),
      e(DAY1, 4, 5_000_000, r1, r1),
      // Daily 08-30 (Loop de Loop), final, which p1 missed: p2 6000000, then p3 and p5
      // tied on 6200000 for the podium (the lower Steam ID first), p6 7000000.
      e(DAY2, 2, 6_000_000, r1, r1),
      e(DAY2, 5, 6_200_000, r1, r1),
      e(DAY2, 3, 6_200_000, r1, r1),
      e(DAY2, 6, 7_000_000, r1, r1),
      // Daily 08-31 (Gone Gully): read live in R1, final in R2, where p1 had improved:
      // p1 2900000, p2 3000000, p7 3500000.
      e(DAY3, 1, 3_100_000, r1, r1, r2),
      e(DAY3, 1, 2_900_000, r2, r2),
      e(DAY3, 2, 3_000_000, r1, r2),
      e(DAY3, 7, 3_500_000, r2, r2),
      // Daily 09-01 (Fresh Fields), live, last read ok in R2: p8 5200000, p1 5500000.
      e(DAY4, 1, 5_500_000, r2, r2),
      e(DAY4, 8, 5_200_000, r2, r2),
    ]);

    // Ghosts, read for their skins (lib/skins.ts): Track p1's run is Pink (its closed
    // run was Magma), p2's Cosmic, p4's a skin the site doesn't know, p5's had no samples,
    // p6's is gone and p7's is Gold. Map A p9's run is Gold. The rest are not read yet.
    // Track p1's, p2's and p7's runs, Map A p9's and Daily 08-29 p1's have a profile, so
    // they race (p2 is ahead of p1 early on); p4's was read before profiles. Map A p10
    // and Daily 08-29 p2 have no Ghost read, so p9 and p1 there race nobody.
    const ghost = (n: number, score: number) => `${String(9_000_000_000 + n)}${String(score)}`;
    const readAt = new Date("2026-09-01T03:10:00Z");
    await tx.insert(ghosts).values([
      {
        ugcId: ghost(1, 1_013_307),
        state: "ok",
        skin: SKIN.pink,
        setAt: new Date("2026-08-31T22:04:00Z"),
        topSpeed: 101.2,
        profile: profile(10.13307, 1),
        readAt,
      },
      { ugcId: ghost(1, 1_050_000), state: "ok", skin: SKIN.magma, readAt },
      {
        ugcId: ghost(2, 1_019_884),
        state: "ok",
        skin: SKIN.cosmic,
        hat: HAT,
        setAt: new Date("2026-08-20T18:30:00Z"),
        topSpeed: 96.5,
        profile: profile(10.19884, 0.98),
        readAt,
      },
      {
        ugcId: ghost(4, 1_100_000),
        state: "ok",
        skin: "/Game/Art/New/MI_NewSkin.MI_NewSkin",
        readAt,
      },
      { ugcId: ghost(5, 1_019_884), state: "empty", readAt },
      { ugcId: ghost(6, 1_200_000), state: "gone", readAt },
      {
        ugcId: ghost(7, 1_100_000),
        state: "ok",
        skin: SKIN.gold,
        topSpeed: 92.4,
        profile: profile(11, 1.03),
        readAt,
      },
      {
        ugcId: ghost(9, 4_200_000),
        state: "ok",
        skin: SKIN.gold,
        topSpeed: 88,
        profile: profile(42, 1),
        readAt,
      },
      {
        ugcId: ghost(1, 4_100_000),
        state: "ok",
        skin: SKIN.pink,
        setAt: new Date("2026-08-29T09:00:00Z"),
        topSpeed: 90.1,
        profile: profile(41, 1),
        readAt,
      },
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
