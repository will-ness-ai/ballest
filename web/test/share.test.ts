// What each share image says (lib/share.ts) over the tiny dataset, read through the same
// queries the card route uses; the expected values come from db/seed/datasets/tiny.ts and
// the Medal times in lib/circuit.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seed } from "../db/seed/harness";
import {
  boardPage,
  boardScores,
  circuitCounts,
  dailyDay,
  derivedStandings,
  playerData,
  workshopMaps,
} from "../db/site";
import { CIRCUIT, circuitBoard } from "../lib/circuit";
import { dayLabel } from "../lib/daily";
import { playerRecord, type IndexBoard } from "../lib/player";
import { shareHref } from "../lib/routes";
import type { WorkshopMap } from "../lib/rows";
import {
  beatAuthor,
  dailyCard,
  mapCard,
  playerCard,
  shortAge,
  trackCard,
  type BoardTop,
} from "../lib/share";
import { freshDb } from "./pg";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const DAY = 86400;

let t: Awaited<ReturnType<typeof freshDb>>;
let boards: Array<IndexBoard>;
let maps: Array<WorkshopMap>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  const counts = await circuitCounts(t.db);
  boards = CIRCUIT.map((b) => ({
    name: b.name,
    group: b.group,
    tier: b.tier,
    display: b.display,
    entryCount: counts[b.name] ?? 0,
  }));
  maps = await workshopMaps(t.db);
});
afterAll(() => t.drop());

async function player(n: number) {
  const data = await playerData(t.db, p(n), await derivedStandings(t.db));
  if (!data) throw new Error(`no player ${String(n)}`);
  return playerCard(playerRecord(data, boards, maps));
}

async function topOf(board: string): Promise<BoardTop> {
  const page = await boardPage(t.db, board, { from: 0, count: 1 });
  return { total: page.total, first: page.rows[0] ?? null, scores: await boardScores(t.db, board) };
}

describe("a player's card", () => {
  test("counts Circuit and Workshop together and leaves out a zero", async () => {
    // Rae: 1st on Track 01 and 2nd on Track 02, both under the author time, and 3rd on
    // Marble Run at a Bronze time; no Map published
    const c = await player(1);
    expect(c.title).toBe("Rolling Rae");
    expect(c.headline).toEqual({ value: "#2", label: "Season 2 Overall", tone: "gold" });
    expect(c.tiles).toEqual([
      { value: "1", label: "World records", tone: "gold" },
      { value: "2", label: "Author medals", tone: "author" },
      { value: "3", label: "Maps finished" },
    ]);
  });

  test("has no headline off Season 2's Overall board, and no world record tile at 0", async () => {
    // Slowpoke: 4th on Track 01, under its author time, and nothing in Season 2
    const c = await player(4);
    expect(c.headline).toBeNull();
    expect(c.tiles.map((s) => s.label)).toEqual(["Author medals", "Maps finished"]);
  });
});

describe("a place's card", () => {
  test("a Workshop Map: its record, then Players, Author time, Beat the author, Published", () => {
    const m = maps.find((x) => x.pfid === "9000000001");
    if (!m) throw new Error("no Marble Run");
    const c = mapCard(m, (m.created + 10 * DAY) * 1000);
    expect(c.kicker).toBe("Workshop map · by Tenpin");
    expect(c.title).toBe("Marble Run");
    expect(c.headline).toEqual({ value: "0:42.000", label: "World record · Ninth", tone: "gold" });
    expect(c.tiles).toEqual([
      { value: "3", label: "Players" },
      { value: "0:38.500", label: "Author time", tone: "author" },
      { value: "0", label: "Beat the author", tone: "author" },
      { value: "10d ago", label: "Published" },
    ]);
  });

  test("a Circuit Track: its record and in-game Medal times; an Overall board has no card", async () => {
    const b = circuitBoard("Map_Track13");
    if (!b) throw new Error("no Track 01");
    const c = trackCard(b, await topOf("Map_Track13"));
    expect(c?.kicker).toBe("Season 1 · Circuit track");
    expect(c?.title).toBe("01");
    expect(c?.headline).toEqual({
      value: "0:10.133",
      label: "World record · Rolling Rae",
      tone: "gold",
    });
    // all six times are under the 12.792 s author time
    expect(c?.tiles.map((s) => s.value)).toEqual(["6", "0:12.792", "6", "0:14.000"]);
    const overall = circuitBoard("OverallLeaderboard_EASeason2");
    if (!overall) throw new Error("no Overall board");
    expect(trackCard(overall, await topOf(overall.name))).toBeNull();
  });

  test("a Daily: the fastest time, live or final alike, and its Gold time", async () => {
    const d = await dailyDay(t.db, "2026-08-30");
    if (!d) throw new Error("no Daily");
    const top = await topOf(d.board);
    const c = dailyCard(d, top);
    expect(c.kicker).toBe("Daily · " + dayLabel("2026-08-30", true));
    expect(c.title).toBe("Loop de Loop");
    expect(c.headline?.label).toBe("Fastest · " + (top.first?.persona ?? ""));
    expect(c.tiles.map((s) => s.label)).toEqual([
      "Players",
      "Author time",
      "Beat the author",
      "Gold time",
    ]);
    expect(c.tiles[3].value).toBe("1:02.000");
  });
});

describe("the parts", () => {
  test("a Map's age reads short", () => {
    const now = 1_800_000_000_000;
    const ago = (days: number) => now / 1000 - days * DAY;
    expect([0, 3, 13, 14, 59, 60, 400].map((d) => shortAge(ago(d), now))).toEqual([
      "Today",
      "3d ago",
      "13d ago",
      "2w ago",
      "8w ago",
      "2mo ago",
      "13mo ago",
    ]);
  });

  test("beating the author is the Medal rule: at or under the author time", () => {
    expect(beatAuthor([1_000_000, 1_200_000, 1_200_001], [20, 15, 13, 12])).toBe(2);
  });

  test("a card's address changes with each Refresh", () => {
    expect(shareHref("player", p(1), 123)).toBe(`/og/player/${p(1)}?v=123`);
  });
});
