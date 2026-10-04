// A player's record and the head to head (lib/player.ts) over the tiny dataset, read
// through the same queries the pages use; every expected value is worked out by hand from
// the comments in db/seed/datasets/tiny.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seed } from "../db/seed/harness";
import { circuitCounts, derivedStandings, playerData, workshopMaps } from "../db/site";
import { CIRCUIT } from "../lib/circuit";
import { matchup, playerRecord, type IndexBoard, type PlayerRecord } from "../lib/player";
import type { WorkshopMap } from "../lib/rows";
import { freshDb } from "./pg";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

let t: Awaited<ReturnType<typeof freshDb>>;
let boards: Array<IndexBoard>;
let maps: Array<WorkshopMap>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  /* the Circuit's boards with their counts, as getSite (db/data.ts) builds them */
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

/* player n's record, over the Workshop's Maps or a changed copy of them */
async function record(n: number, over: ReadonlyArray<WorkshopMap> = maps): Promise<PlayerRecord> {
  const data = await playerData(t.db, p(n), await derivedStandings(t.db));
  if (!data) throw new Error(`no player ${String(n)}`);
  return playerRecord(data, boards, over);
}

describe("a player's record", () => {
  test("opens on the Workshop tab with a Workshop time, else on the Circuit", async () => {
    expect((await record(1)).home).toBe("workshop");
    expect((await record(4)).home).toBe("circuit");
  });

  test("the Circuit: Medals, each season's Tracks and points, the newest season first", async () => {
    const r = await record(1);
    expect(r.who).toEqual({
      steamId: p(1),
      persona: "Rolling Rae",
      avatar: "https://avatars.example.invalid/1_medium.jpg",
    });
    expect(r.allSeasons).toEqual({ rank: 1, score: 61450 });
    expect(r.medals).toEqual({ gold: 1, silver: 1, bronze: 0 });
    expect(r.golds).toEqual(["01"]);
    expect([r.run, r.tracks]).toEqual([2, 20]);
    expect(r.seasons.map((s) => s.group)).toEqual(["Season 2", "Season 1"]);
    const s1 = r.seasons[1];
    // Season 1's Overall is its current board, added up from the same Tracks
    expect(s1).toMatchObject({ overall: { rank: 1, score: 60000 }, points: 60000, lagging: false });
    expect(s1.tiers.map((x) => x.tier)).toEqual(["Circuit"]);
    expect(s1.tiers[0].tracks.filter((x) => x.finish)).toEqual([
      {
        name: "Map_Track13",
        display: "01",
        field: 6,
        finish: { rank: 1, score: 1_013_307, lead: 1_013_307 },
        points: 40000,
      },
      {
        name: "Map_Track15",
        display: "02",
        field: 3,
        finish: { rank: 2, score: 1_900_000, lead: 1_800_000 },
        points: 20000,
      },
    ]);
  });

  test("Steam's Overall lags when it disagrees with what the Tracks add up to", async () => {
    // Season 2's Overall has p1 on 1450, but no Season 2 Track has a time from them
    const s2 = (await record(1)).seasons[0];
    expect(s2).toMatchObject({ overall: { rank: 2, score: 1450 }, points: 0, lagging: true });
    expect(s2.tiers.map((x) => x.tier)).toEqual(["Beginner", "Intermediate", "Advanced"]);
    expect(s2.tiers.flatMap((x) => x.tracks).filter((x) => x.finish)).toEqual([]);
  });

  test("a Workshop finish carries its Medal, its gap to the record and who holds it", async () => {
    const w = (await record(1)).workshop;
    expect(w.finishes).toEqual([
      {
        name: "Workshop_9000000001",
        pfid: "9000000001",
        display: "Marble Run",
        creator: "Tenpin",
        preview: "https://images.example.invalid/marble-run.jpg",
        created: Date.parse("2026-08-30T12:00:00Z") / 1000,
        field: 3,
        rank: 3,
        score: 5_000_000,
        gap: 800_000,
        // 50s is over the gold (40s) and silver (45s) times, under bronze (60s)
        medal: "bronze",
        holder: { steamId: p(9), persona: "Ninth" },
      },
    ]);
    expect(w.medals).toEqual({ wr: 0, author: 0, gold: 0, silver: 0, bronze: 1, none: 0 });
    expect([w.maps, w.podiums, w.near]).toEqual([2, 1, 0]);
  });

  test("the creator's own Map is on their Made tab, with its record", async () => {
    const r = await record(10);
    expect(r.made).toEqual([
      {
        name: "Workshop_9000000001",
        display: "Marble Run",
        preview: "https://images.example.invalid/marble-run.jpg",
        author: 38.5,
        runs: 3,
        subs: 9,
        beaten: 0,
        record: { score: 4_200_000, who: { steamId: p(9), persona: "Ninth" } },
      },
    ]);
    // Ninth holds it, not Tenpin; Tenpin's world record is on Ninth's Map
    expect(r.holds).toBe(0);
    expect(r.workshop.finishes.map((f) => [f.name, f.rank, f.medal])).toEqual([
      ["Workshop_9000000002", 1, "wr"],
      ["Workshop_9000000001", 2, "bronze"],
    ]);
  });

  test("a creator's own run at the author time earns the author Medal", async () => {
    // Tenpin's 48s on their own Map, with its author time moved to 48s: no creator margin
    // here, which is authorBeaten's alone (lib/rules.ts)
    const moved = maps.map((m) =>
      m.pfid === "9000000001" ? { ...m, medals: [60, 50, 49, 48] } : m,
    );
    const r = await record(10, moved);
    expect(r.workshop.finishes.find((f) => f.pfid === "9000000001")?.medal).toBe("author");
    expect(r.made[0].author).toBe(48);
  });

  test("a Map nobody has a time on stays on Made, with no runs or record", async () => {
    const untimed = maps.map((m) => (m.pfid === "9000000001" ? { ...m, top3: [] } : m));
    const r = await record(10, untimed);
    expect(r.made).toMatchObject([
      { name: "Workshop_9000000001", runs: 0, beaten: 0, record: null },
    ]);
    expect(r.workshop.finishes.map((f) => f.name)).toEqual(["Workshop_9000000002"]);
  });
});

describe("the head to head", () => {
  test("every board both have a time on, each with its winner and margin", async () => {
    const m = matchup(await record(1), await record(2));
    expect(m.rows.map((r) => [r.scope, r.name, r.title, r.a.score, r.b.score, r.d, r.win])).toEqual(
      [
        ["circuit", "Map_Track13", "S1 01", 1_013_307, 1_019_884, -6577, "a"],
        ["circuit", "Map_Track15", "S1 02", 1_900_000, 1_800_000, 100_000, "b"],
      ],
    );
    // the margin as a share of the faster time
    expect(m.rows[1].rel).toBeCloseTo(100_000 / 1_800_000);
    expect(m.tally).toEqual({
      all: { n: 2, a: 1, b: 1 },
      circuit: { n: 2, a: 1, b: 1 },
      workshop: { n: 0, a: 0, b: 0 },
    });
    expect(m.band.map((s) => [s.label, s.a, s.b, s.win])).toEqual([
      ["All seasons", 1, 2, "a"],
      ["Season 2 overall", 2, 3, "a"],
      ["World records", 1, 1, null],
      ["Workshop maps finished", 1, 1, null],
      ["Maps made", 0, 0, null],
    ]);
  });

  test("a Map both finished counts on the Workshop side", async () => {
    const m = matchup(await record(1), await record(10));
    expect(m.rows).toMatchObject([
      {
        scope: "workshop",
        name: "Workshop_9000000001",
        title: "Marble Run",
        preview: "https://images.example.invalid/marble-run.jpg",
        field: 3,
        d: 200_000,
        win: "b",
      },
    ]);
    expect(m.tally.workshop).toEqual({ n: 1, a: 0, b: 1 });
    expect(m.band.find((s) => s.label === "Maps made")).toMatchObject({ a: 0, b: 1, win: "b" });
  });

  test("an equal time is a tie, which neither side's count takes", async () => {
    // p2 and p5 both have 1019884 on Track 01
    const m = matchup(await record(2), await record(5));
    expect(m.rows).toMatchObject([{ name: "Map_Track13", d: 0, win: "tie", rel: 0 }]);
    expect(m.tally.all).toEqual({ n: 1, a: 0, b: 0 });
  });
});
