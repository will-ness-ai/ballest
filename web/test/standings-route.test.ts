// The Workshop standings read from the tiny dataset (workshopStandings in db/site.ts) and
// served by GET /api/standings. Expected values are worked out by hand from the comments in
// db/seed/datasets/tiny.ts: Map A (Author 38.5 s, by p10) holds p9 4200000 (4500000 until
// R3), p10 4800000 and p1 5000000 (from R3); Map B (Author 58.25 s, by p9) holds p10 6100000
// and p2 6900000; Map C has left the Workshop. Nobody beats an Author Medal, and p10's own
// time on Map A is no finish.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/api/standings/route";
import type { Db } from "../db/client";
import { seed } from "../db/seed/harness";
import { workshopStandings } from "../db/site";
import type { LadderRow, YouLadders } from "../lib/ladder";
import type { WorkshopStandings } from "../lib/rows";
import { freshDb } from "./pg";

/* the cached reads run uncached outside Next, on this file's database */
const testDb = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("next/cache", () => ({ cacheTag: () => undefined, cacheLife: () => undefined }));
vi.mock("../db/client", async (original) => {
  const { connect } = await original<typeof import("../db/client")>();
  return { connect: (url: string) => testDb.db ?? connect(url) };
});

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
/* between R2 (03:00) and R3 (06:00) */
const R2_AND_A_BIT = Date.parse("2026-09-01T04:00:00Z");

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  testDb.db = t.db;
  process.env.DATABASE_URL = t.url;
});
afterAll(() => t.drop());
afterEach(() => vi.useRealTimers());

/* one list as [steam ID, persona, now, at the baseline, place now, place at the baseline] */
const named = (s: WorkshopStandings, stat: keyof WorkshopStandings["lists"]) =>
  s.lists[stat].map(([i, ...rest]) => [...s.players[i], ...rest]);

describe("the Workshop standings at a baseline", () => {
  test("count the listed Maps now and then, with shared places", async () => {
    const s = await workshopStandings(t.db, R2_AND_A_BIT);
    expect(s.readAt).toBe("2026-09-01T06:05:00.000Z");
    expect(s.since).toBe("2026-09-01T04:00:00.000Z");
    expect(s.maps).toBe(2);
    // p1's first time on Map A came in R3, after the baseline
    expect(named(s, "played")).toEqual([
      [p(1), "Rolling Rae", 1, 0, 1, 4],
      [p(2), "Justy Sparks", 1, 1, 1, 1],
      [p(9), "Ninth", 1, 1, 1, 1],
      [p(10), "Tenpin", 1, 1, 1, 1],
    ]);
    expect(named(s, "wr")).toEqual([
      [p(9), "Ninth", 1, 1, 1, 1],
      [p(10), "Tenpin", 1, 1, 1, 1],
    ]);
    // every top 5 is one, so the world records list first
    expect(named(s, "top5")).toEqual([
      [p(9), "Ninth", 1, 1, 1, 1],
      [p(10), "Tenpin", 1, 1, 1, 1],
      [p(1), "Rolling Rae", 1, 0, 1, 4],
      [p(2), "Justy Sparks", 1, 1, 1, 1],
    ]);
    expect(s.lists.author).toEqual([]);
  });
});

async function get(query = "") {
  const res = await GET(new Request(`http://site.invalid/api/standings${query}`));
  return { status: res.status, body: (await res.json()) as WorkshopStandings };
}

describe("GET /api/standings", () => {
  test("defaults to the /you baseline, before which no listed board had been read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T05:00:00Z"));
    const { status, body } = await get();
    expect(status).toBe(200);
    // 24 hours before the 16:00 UTC of 2026-09-01
    expect(body.since).toBe("2026-08-31T16:00:00.000Z");
    // both Maps were first read in R1, after it: they count as they stand, so no gains
    expect(named(body, "played")).toEqual([
      [p(1), "Rolling Rae", 1, 1, 1, 1],
      [p(2), "Justy Sparks", 1, 1, 1, 1],
      [p(9), "Ninth", 1, 1, 1, 1],
      [p(10), "Tenpin", 1, 1, 1, 1],
    ]);
  });

  test("takes a baseline as an ISO time or Unix ms, read to the hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T05:00:00Z"));
    const iso = await get("?since=2026-09-01T04:30:00Z");
    expect(iso.status).toBe(200);
    expect(iso.body.since).toBe("2026-09-01T04:00:00.000Z");
    expect(named(iso.body, "played")[0]).toEqual([p(1), "Rolling Rae", 1, 0, 1, 4]);
    const ms = await get(`?since=${String(R2_AND_A_BIT + 1_000)}`);
    expect(ms.body).toEqual(iso.body);
  });

  test("refuses a baseline it can't read, in the future, or over a week back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T05:00:00Z"));
    expect((await get("?since=yesterday")).status).toBe(400);
    expect((await get("?since=2026-09-02T07:00:00Z")).status).toBe(400);
    expect((await get("?since=2026-08-25T00:00:00Z")).status).toBe(400);
  });
});

/* a read of the /you modes, whose bodies aren't the whole standings */
async function read<T>(query: string) {
  const res = await GET(new Request(`http://site.invalid/api/standings${query}`));
  return { status: res.status, body: (await res.json()) as T };
}

describe("GET /api/standings?ladders: You's four cards", () => {
  test("each list's ladder around the player, against the /you baseline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T05:00:00Z"));
    const { status, body } = await read<YouLadders>("?ladders&player=" + p(1));
    expect(status).toBe(200);
    expect(body.readAt).toBe("2026-09-01T06:05:00.000Z");
    expect(body.since).toBe("2026-08-31T16:00:00.000Z");
    // four players level on one Map each, all 1st, nobody moved
    expect(body.lists.played.total).toBe(4);
    expect(body.lists.played.you).toEqual({
      steamId: p(1),
      persona: "Rolling Rae",
      n: 1,
      gain: 0,
      place: 1,
      shared: true,
      move: 0,
    });
    // listed first of the four by Steam ID, level for the lead
    expect(body.lists.played.chase).toEqual({ to: "outright" });
    // p1 holds no world record
    expect(body.lists.wr).toMatchObject({ total: 2, you: null, chase: { to: "join" } });
    expect(body.lists.author).toEqual({ total: 0, rows: [], you: null, chase: { to: "join" } });
  });

  test("at a given baseline: p1's Map arrived after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T05:00:00Z"));
    const { body } = await read<YouLadders>(
      "?ladders&player=" + p(1) + "&since=2026-09-01T04:00:00Z",
    );
    expect(body.lists.played.you).toMatchObject({ n: 1, gain: 1, place: 1, move: null });
  });

  test("with nobody signed in, the top 3; a player that isn't a Steam ID is a 400", async () => {
    const { body } = await read<YouLadders>("?ladders");
    expect(body.lists.top5.rows.map((r) => r?.steamId)).toEqual([p(9), p(10), p(1)]);
    expect(body.lists.top5.you).toBeNull();
    expect((await read("?ladders&player=nope")).status).toBe(400);
  });
});

describe("GET /api/standings?list=: a slice for Show all", () => {
  test("rows in listing order from `from`, and the list's length", async () => {
    const { status, body } = await read<{ total: number; rows: Array<LadderRow> }>(
      "?list=top5&from=1&count=2",
    );
    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.rows.map((r) => [r.steamId, r.place])).toEqual([
      [p(10), 1],
      [p(1), 1],
    ]);
  });

  test("a list that isn't one is a 400", async () => {
    expect((await read("?list=podiums")).status).toBe(400);
  });
});
