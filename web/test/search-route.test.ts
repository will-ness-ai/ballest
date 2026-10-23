// GET /api/search on the stress dataset (db/seed/datasets/stress.ts, which holds all of tiny),
// with one more Map by a maker who has no time on any board. Expected hits come from the
// datasets' comments: Rolling Rae is tiny's p1, Tenpin (p10) made Marble Run and Solar Trials
// Mercury, the long-named player made the long-titled Map, Solar Trials is listed with its
// first Map, Season 1's Tracks are 01 and 02, and the Dailies run 2026-08-29 to 09-01.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/api/search/route";
import type { Db } from "../db/client";
import { boardReads, boards, entries, mapHistory, maps, players } from "../db/schema";
import { seed } from "../db/seed/harness";
import type { SearchAnswer, SearchKind } from "../lib/search";
import { freshDb } from "./pg";

/* the cached reads run uncached outside Next, on this file's database */
const testDb = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("next/cache", () => ({ cacheTag: () => undefined, cacheLife: () => undefined }));
vi.mock("../db/client", async (original) => {
  const { connect } = await original<typeof import("../db/client")>();
  return { connect: (url: string) => testDb.db ?? connect(url) };
});

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const MAKER = p(12);

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "stress");
  // Mapwright made Pebble Path, on which only p1 has a time
  await t.db.transaction(async (tx) => {
    await tx.insert(players).values({
      steamId: MAKER,
      persona: "Mapwright",
      avatar: null,
      profileUrl: `https://steamcommunity.com/profiles/${MAKER}/`,
    });
    await tx.insert(boards).values({
      name: "Workshop_9000000007",
      kind: "map",
      display: "Pebble Path",
      leaderboardId: 90000007,
      scoresPoints: false,
    });
    await tx
      .insert(boardReads)
      .values({ refreshId: 3, board: "Workshop_9000000007", ok: true, entryCount: 1 });
    await tx.insert(entries).values({
      board: "Workshop_9000000007",
      steamId: p(1),
      score: 3_000_000,
      ugcId: "9300000001",
      firstSeenRefresh: 3,
      lastSeenRefresh: 3,
      closedRefresh: null,
    });
    await tx.insert(maps).values({
      pfid: "9000000007",
      board: "Workshop_9000000007",
      creatorSteamId: MAKER,
      createdAt: new Date("2026-08-31T20:00:00Z"),
    });
    await tx.insert(mapHistory).values({
      pfid: "9000000007",
      title: "Pebble Path",
      creator: "Mapwright",
      preview: null,
      medals: [40, 30, 25, 20],
      sessions: 1,
      subs: 1,
      entryCount: 1,
      firstSeenRefresh: 3,
      lastSeenRefresh: 3,
    });
  });
  testDb.db = t.db;
  process.env.DATABASE_URL = t.url;
}, 60_000);
afterAll(() => t.drop());

async function search(q: string) {
  const res = await GET(new Request("http://site.invalid/api/search?q=" + encodeURIComponent(q)));
  return { status: res.status, body: (await res.json()) as SearchAnswer | null };
}
const of = async (q: string, kind: SearchKind) =>
  (await search(q)).body?.hits.filter((h) => h.kind === kind) ?? [];

describe("GET /api/search", () => {
  test("finds a player by name", async () => {
    expect(await of("rae", "people")).toEqual([
      expect.objectContaining({ href: "/player/" + p(1), title: "Rolling Rae", tag: "Player" }),
    ]);
  });

  test("finds a maker with the Maps they made, and one with no times at their Made tab", async () => {
    expect(await of("tenpin", "people")).toEqual([
      expect.objectContaining({ href: "/player/" + p(10), meta: "Player · made 2 Maps" }),
    ]);
    expect(await of("mapwright", "people")).toEqual([
      expect.objectContaining({ href: `/player/${MAKER}/made`, meta: "Made 1 Map" }),
    ]);
  });

  test("finds a Map, and counts every Map that matched", async () => {
    const { body } = await search("rocky");
    expect(body?.hits.filter((h) => h.kind === "maps")).toEqual([
      expect.objectContaining({
        href: "/map/9000000005",
        title: "Rocky Alpine but backwards or something like that",
      }),
    ]);
    expect(body?.mapTotal).toBe(1);
  });

  test("finds a Campaign", async () => {
    expect(await of("solar", "campaigns")).toEqual([
      expect.objectContaining({ href: "/campaign/solar-trials", title: "Solar Trials" }),
    ]);
  });

  test("finds a Track by its number", async () => {
    expect((await of("02", "tracks"))[0]).toEqual(
      expect.objectContaining({ href: "/board/Map_Track15", title: "Season 1 · 02" }),
    );
  });

  test("finds a Daily by its date, and a Prefab by its name", async () => {
    expect(await of("2026-08-30", "dailies")).toEqual([
      expect.objectContaining({ href: "/daily/2026-08-30", title: "Loop de Loop" }),
    ]);
    expect(await of("twin", "prefabs")).toEqual([
      expect.objectContaining({ href: "/prefab/twin-cubes", title: "Twin cubes" }),
    ]);
  });

  test("lets the CDN keep an answer for ten minutes, and serve it stale for a Refresh's length", async () => {
    const res = await GET(new Request("http://site.invalid/api/search?q=rae"));
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=600, stale-while-revalidate=10800",
    );
  });

  test("answers an empty query with null, and reads only the first 64 characters", async () => {
    expect(await search("")).toEqual({ status: 200, body: null });
    expect(await search("   ")).toEqual({ status: 200, body: null });
    const long = await search("X".repeat(200));
    expect(long.status).toBe(200);
    expect(long.body).toEqual({ q: "x".repeat(64), hits: [], mapTotal: 0 });
  });
});
