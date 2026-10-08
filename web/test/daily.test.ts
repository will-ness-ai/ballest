// The Daily reads (db/site.ts) against the tiny dataset; every expected value is worked out
// by hand from the comments in db/seed/datasets/tiny.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seed } from "../db/seed/harness";
import {
  boardPage,
  dailies,
  dailyDates,
  dailyDay,
  dailyStandings,
  playerDailies,
} from "../db/site";
import { medalTable, recordLine, type MedalColumn } from "../lib/daily";
import { freshDb } from "./pg";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const DAY2 = "ballest_v0_9000000002_Daily_20260830_aa000002";
const DAY3 = "ballest_v0_9000000003_Daily_20260831_aa000003";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
});
afterAll(() => t.drop());

describe("one Daily", () => {
  test("its Map, window and whether a read after its close made it final", async () => {
    expect(await dailyDay(t.db, "2026-08-31")).toEqual({
      date: "2026-08-31",
      board: DAY3,
      pfid: "9000000003",
      title: "Gone Gully",
      preview: null,
      medals: [40, 30, 25, 22],
      listed: false,
      startsAt: "2026-08-31T01:00:00.000Z",
      endsAt: "2026-09-01T01:00:00.000Z",
      final: true,
      entryCount: 3,
    });
  });

  test("a live Daily on a Map no catalogue listed has no picture or Medals", async () => {
    expect(await dailyDay(t.db, "2026-09-01")).toMatchObject({
      title: "Fresh Fields",
      preview: null,
      medals: [],
      listed: false,
      final: false,
      // R3's read failed, so R2's two times stand
      entryCount: 2,
    });
    expect(await dailyDay(t.db, "2026-08-29")).toMatchObject({
      preview: "https://images.example.invalid/marble-run.jpg",
      medals: [60, 45, 40, 38.5],
      listed: true,
    });
  });

  test("a date with no Daily is null", async () => {
    expect(await dailyDay(t.db, "2026-08-28")).toBeNull();
  });

  test("every Daily's date, oldest first", async () => {
    expect(await dailyDates(t.db)).toEqual([
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });
});

describe("every Daily", () => {
  test("oldest first, each with its Map, window, times and winner", async () => {
    const all = await dailies(t.db);
    expect(all.map((d) => [d.date, d.title, d.final, d.entryCount, d.winner])).toEqual([
      ["2026-08-29", "Marble Run", true, 4, { steamId: p(1), persona: "Rolling Rae" }],
      ["2026-08-30", "Loop de Loop", true, 4, { steamId: p(2), persona: "Justy Sparks" }],
      // p1's improved time won, not the one R2 closed
      ["2026-08-31", "Gone Gully", true, 3, { steamId: p(1), persona: "Rolling Rae" }],
      // live, and R3's failed read leaves R2's leader
      ["2026-09-01", "Fresh Fields", false, 2, { steamId: p(8), persona: "Points Pat" }],
    ]);
    expect(all[0]).toMatchObject({
      pfid: "9000000001",
      preview: "https://images.example.invalid/marble-run.jpg",
      startsAt: "2026-08-29T01:00:00.000Z",
      endsAt: "2026-08-30T01:00:00.000Z",
    });
    expect(all[3].preview).toBeNull();
  });
});

describe("a Daily's board", () => {
  test("ranks fastest first, a tie by the lower Steam ID, and pages like a Map's", async () => {
    const all = await boardPage(t.db, DAY2, { count: 10 });
    expect(all.total).toBe(4);
    expect(all.rows.map((r) => [r.rank, r.steamId, r.score, r.ahead])).toEqual([
      [1, p(2), 6_000_000, null],
      [2, p(3), 6_200_000, 6_000_000],
      [3, p(5), 6_200_000, 6_200_000],
      [4, p(6), 7_000_000, 6_200_000],
    ]);
    const page = await boardPage(t.db, DAY2, { from: 2, count: 1 });
    expect(page.rows.map((r) => [r.rank, r.steamId])).toEqual([[3, p(5)]]);
  });

  test("holds a player's latest time only", async () => {
    const page = await boardPage(t.db, DAY3, { count: 10 });
    expect(page.rows.map((r) => [r.steamId, r.score])).toEqual([
      [p(1), 2_900_000],
      [p(2), 3_000_000],
      [p(7), 3_500_000],
    ]);
  });
});

describe("the Daily standings", () => {
  test("count each player's places over final Dailies only, and both runs, in medal order", async () => {
    const s = await dailyStandings(t.db);
    expect([s.dailies, s.since]).toEqual([3, "2026-08-29"]);
    // [player, 1st, 2nd, 3rd, podiums, top 10s, played, run of days played, run of wins];
    // p8 led only the live Daily, so isn't here
    expect(
      s.players.map((x) => [
        x.steamId,
        x.gold,
        x.silver,
        x.bronze,
        x.podiums,
        x.top10,
        x.played,
        x.playedRun,
        x.winRun,
      ]),
    ).toEqual([
      // won 08-29 and 08-31 but missed 08-30, so neither run is longer than a day
      [p(1), 2, 0, 0, 2, 2, 2, 1, 1],
      [p(2), 1, 2, 0, 3, 3, 3, 3, 1],
      [p(3), 0, 1, 1, 2, 2, 2, 2, 0],
      // 3rd on 08-30's tie, where the lower Steam ID (p3) takes 2nd, as the board ranks it
      [p(5), 0, 0, 1, 1, 1, 1, 1, 0],
      [p(7), 0, 0, 1, 1, 1, 1, 1, 0],
      [p(4), 0, 0, 0, 0, 1, 1, 1, 0],
      [p(6), 0, 0, 0, 0, 1, 1, 1, 0],
    ]);
    expect(s.players[1]).toMatchObject({ persona: "Justy Sparks" });
  });

  test("each record's top three, equal values sharing a place", async () => {
    const { records } = await dailyStandings(t.db);
    const top = Object.fromEntries(
      records.map((r) => [r.key, [r.holders.map((h) => [h.steamId, h.value, h.place]), r.more]]),
    );
    expect(top).toEqual({
      wins: [
        [
          [p(1), 2, 1],
          [p(2), 1, 2],
        ],
        0,
      ],
      // p1 and p3 share 2nd, p1 shown first for its golds
      podiums: [
        [
          [p(2), 3, 1],
          [p(1), 2, 2],
          [p(3), 2, 2],
        ],
        0,
      ],
      played: [
        [
          [p(2), 3, 1],
          [p(1), 2, 2],
          [p(3), 2, 2],
        ],
        0,
      ],
      // five players on a run of one day share 3rd: one plate, four more
      playedRun: [
        [
          [p(2), 3, 1],
          [p(3), 2, 2],
          [p(1), 1, 3],
        ],
        4,
      ],
      winRun: [
        [
          [p(1), 1, 1],
          [p(2), 1, 1],
        ],
        0,
      ],
    });
  });

  test("the medal table sorts on any column, medal order breaking ties", async () => {
    const { players } = await dailyStandings(t.db);
    const table = (by: MedalColumn) => medalTable(players, by).map((r) => [r.rank, r.s.steamId]);
    // podium finishers only; p5 and p7 alike on every count share 4th
    expect(table("gold")).toEqual([
      [1, p(1)],
      [2, p(2)],
      [3, p(3)],
      [4, p(5)],
      [4, p(7)],
    ]);
    expect(table("bronze")).toEqual([
      [1, p(3)],
      [2, p(5)],
      [2, p(7)],
      [4, p(1)],
      [5, p(2)],
    ]);
    // Played takes in everyone who played, p4 and p6 too
    expect(table("played")).toEqual([
      [1, p(2)],
      [2, p(1)],
      [3, p(3)],
      [4, p(5)],
      [4, p(7)],
      [6, p(4)],
      [6, p(6)],
    ]);
  });

  test("a record plate's line says who holds it, who shares it and how far behind", async () => {
    const { records } = await dailyStandings(t.db);
    const lines = Object.fromEntries(
      records.map((r) => [r.key, r.holders.map((_, i) => recordLine(r, i))]),
    );
    expect(lines).toEqual({
      wins: ["holds the record", "1 behind"],
      podiums: ["holds the record", "1 behind", "1 behind"],
      played: ["holds the record", "1 behind", "1 behind"],
      playedRun: ["holds the record", "1 behind", "2 behind · 4 more"],
      winRun: ["shares the record", "shares the record"],
    });
  });
});

describe("a player's Dailies", () => {
  test("their place and field on each Daily they played, and their runs of days", async () => {
    // p1 won 08-29, missed 08-30, won 08-31 and is 2nd on today's live Daily, which
    // counts toward the run going now
    expect(await playerDailies(t.db, p(1))).toEqual({
      played: [
        { date: "2026-08-29", rank: 1, field: 4, final: true },
        { date: "2026-08-31", rank: 1, field: 3, final: true },
        { date: "2026-09-01", rank: 2, field: 2, final: false },
      ],
      won: 2,
      podiums: 2,
      longest: 2,
      current: 2,
    });
  });

  test("today's live Daily not played yet leaves the run up to yesterday going", async () => {
    // p2 played 08-29 to 08-31 and has no time on 09-01 yet
    expect(await playerDailies(t.db, p(2))).toMatchObject({ longest: 3, current: 3 });
  });

  test("a final Daily missed ends the run going now", async () => {
    // p3 played 08-29 and 08-30 (2nd on the tie with p5, the lower Steam ID), then missed 08-31
    expect(await playerDailies(t.db, p(3))).toEqual({
      played: [
        { date: "2026-08-29", rank: 3, field: 4, final: true },
        { date: "2026-08-30", rank: 2, field: 4, final: true },
      ],
      won: 0,
      podiums: 2,
      longest: 2,
      current: 0,
    });
  });

  test("leading today's live Daily is not a win or a podium until it is final", async () => {
    // p8's only time is 1st on 09-01, still live
    expect(await playerDailies(t.db, p(8))).toEqual({
      played: [{ date: "2026-09-01", rank: 1, field: 2, final: false }],
      won: 0,
      podiums: 0,
      longest: 1,
      current: 1,
    });
  });

  test("a player with no Daily time has none", async () => {
    expect(await playerDailies(t.db, p(9))).toEqual({
      played: [],
      won: 0,
      podiums: 0,
      longest: 0,
      current: 0,
    });
  });
});
