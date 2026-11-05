// What a player's Stat Card says (lib/stat-card.ts): its rows, which it leaves out, and its
// date. The record is a hand-made one, holding only what the card reads; the expected counts
// are worked out by hand from it.
import { describe, expect, test } from "vitest";

import type { PlayerRecord, TrackTile, WorkshopFinish } from "../lib/player";
import type { MedalKey } from "../lib/rules";
import { nameSize } from "../components/share/StatCard";
import { cardDate, statCard } from "../lib/stat-card";

const ID = "76561199000000001";
const COSMIC =
  "/Game/Packs/Vefects/Stylized_Galaxy_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02";
/* 22 Oct 2026, 21:00 UTC: a Refresh's time */
const ASOF = Date.UTC(2026, 9, 22, 21);

const track = (rank: number, earned: MedalKey) =>
  ({ finish: { rank, score: 1, lead: 0, earned } }) as TrackTile;
const unrun = { finish: null } as TrackTile;
const finish = (rank: number, earned: MedalKey) => ({ rank, earned }) as WorkshopFinish;

interface Shape {
  s1?: number;
  s2?: number;
  tracks?: Array<TrackTile>;
  finishes?: Array<WorkshopFinish>;
}

/* a record as playerRecord builds one: run counts the Tracks with a time, medals.gold the
   Tracks at rank 1, and the Workshop's wr the Maps at rank 1 */
function record({ s1, s2, tracks = [], finishes = [] }: Shape): PlayerRecord {
  const season = (group: string, rank: number | undefined, t: Array<TrackTile>) => ({
    group,
    overall: rank === undefined ? null : { rank, score: 1000 },
    tiers: [{ tier: "", tracks: t, points: 0 }],
  });
  return {
    id: ID,
    who: { steamId: ID, persona: "Rolling Rae" },
    medals: { gold: tracks.filter((t) => t.finish?.rank === 1).length, silver: 0, bronze: 0 },
    run: tracks.filter((t) => t.finish).length,
    trials: [],
    trialsRun: 0,
    made: [],
    seasons: [season("Season 2", s2, tracks.slice(0, 2)), season("Season 1", s1, tracks.slice(2))],
    workshop: {
      finishes,
      medals: { wr: finishes.filter((f) => f.rank === 1).length },
    },
  } as unknown as PlayerRecord;
}

describe("a Stat Card's rows", () => {
  test("in order: the two Circuit ranks, then the Medals and Maps finished, Circuit and Workshop together", () => {
    // Circuit: a world record at the author time, 2nd at Gold, 5th at Silver, one not run.
    // Workshop: a world record at Gold, 3rd at the author time, two at Bronze, one with none.
    const c = statCard(
      record({
        s1: 11,
        s2: 1204,
        tracks: [track(1, "author"), track(2, "gold"), track(5, "silver"), unrun],
        finishes: [
          finish(1, "gold"),
          finish(3, "author"),
          finish(8, "bronze"),
          finish(9, "bronze"),
          finish(12, "none"),
        ],
      }),
      ASOF,
      undefined,
    );
    expect(c.rows).toEqual([
      { kind: "s1", label: "Season 1 Circuit", value: "#11" },
      { kind: "s2", label: "Season 2 Circuit", value: "#1,204" },
      { kind: "wr", label: "World records", value: "2" },
      { kind: "author", label: "Author medals", value: "2" },
      { kind: "gold", label: "Gold medals", value: "2" },
      { kind: "silver", label: "Silver medals", value: "1" },
      { kind: "bronze", label: "Bronze medals", value: "2" },
      { kind: "finished", label: "Maps finished", value: "8" },
    ]);
  });

  test("leave out a missing rank and a count of zero", () => {
    // Season 2 only, two Workshop finishes at Bronze
    const c = statCard(
      record({ s2: 40, finishes: [finish(4, "bronze"), finish(6, "bronze")] }),
      ASOF,
      undefined,
    );
    expect(c.rows).toEqual([
      { kind: "s2", label: "Season 2 Circuit", value: "#40" },
      { kind: "bronze", label: "Bronze medals", value: "2" },
      { kind: "finished", label: "Maps finished", value: "2" },
    ]);
  });

  test("a player with nothing to show has no rows", () => {
    expect(statCard(record({}), ASOF, undefined).rows).toEqual([]);
  });
});

describe("a Stat Card", () => {
  test("names the player and draws their hue", () => {
    const c = statCard(record({}), ASOF, undefined);
    expect(c.name).toBe("Rolling Rae");
    expect(c.hue).toBeGreaterThanOrEqual(0);
    expect(c.hue).toBeLessThan(360);
  });

  test("wears the Chosen Skin's picture, and the marble for none or one the site doesn't know", () => {
    expect(statCard(record({}), ASOF, COSMIC).skin).toBe("DA_Skin_Cosmic1");
    expect(statCard(record({}), ASOF, undefined).skin).toBeNull();
    expect(statCard(record({}), ASOF, "/Game/Nope.Nope").skin).toBeNull();
  });

  test("badges the player's Steam avatar, and none for a player without one", () => {
    const rae = record({});
    expect(statCard(rae, ASOF, undefined).avatar).toBeNull();
    rae.who.avatar = "https://avatars.steamstatic.com/rae_medium.jpg";
    expect(statCard(rae, ASOF, undefined).avatar).toBe(
      "https://avatars.steamstatic.com/rae_medium.jpg",
    );
  });

  test("is dated with the Refresh's day in UTC", () => {
    expect(statCard(record({}), ASOF, undefined).date).toBe("22 OCT 2026");
  });
});

describe("the date", () => {
  test("is the UTC day, its month short and upper case", () => {
    expect(cardDate(Date.UTC(2026, 8, 3, 23, 59))).toBe("3 SEP 2026");
    // 00:30 on 1 Jan in UTC is still 31 Dec west of it; the card reads UTC
    expect(cardDate(Date.UTC(2027, 0, 1, 0, 30))).toBe("1 JAN 2027");
  });
});

describe("a Stat Card's name", () => {
  /* the line the name has (720 less the frame and padding), and Bungee's M in ems */
  const LINE = 628;
  const M = 0.849;

  test("is drawn large while it is short, and steps down so 32 of the widest letters fit", () => {
    expect(nameSize("Rae")).toBe(56);
    for (let n = 1; n <= 32; n++) expect(n * M * nameSize("W".repeat(n))).toBeLessThanOrEqual(LINE);
    expect(nameSize("W".repeat(32))).toBe(23);
    /* longer than any Steam persona: drawn at the 32's size and cut */
    expect(nameSize("W".repeat(40))).toBe(23);
  });

  test("counts an emoji as one wide glyph, and CJK and other scripts as wide, so they fit too", () => {
    const WIDE = 1.25;
    const family = "👨‍👩‍👧";
    // five code points joined: one emoji, as wide as one CJK character
    expect(nameSize(family.repeat(20))).toBe(nameSize("球".repeat(20)));
    for (const glyph of [family, "🔥", "球", "ボ", "Ж"])
      for (let n = 1; n <= 32; n++)
        expect(n * WIDE * nameSize(glyph.repeat(n))).toBeLessThanOrEqual(LINE);
    // accented Latin is Bungee's own, as narrow as plain
    expect(nameSize("É".repeat(32))).toBe(23);
    expect(nameSize("E\u0301".repeat(32))).toBe(23);
    // a mixed name: 10 Latin and 10 wide
    expect(nameSize("W".repeat(10) + "球".repeat(10))).toBe(
      Math.floor(LINE / (10 * 0.85 + 10 * WIDE)),
    );
  });
});
