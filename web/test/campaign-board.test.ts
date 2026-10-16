// A Campaign's derived board, OverallCampaign_<slug>, over a test Campaign of the tiny
// dataset's Maps, read through the site's queries and the board API every board page
// uses. Expected values are worked out by hand from db/seed/datasets/tiny.ts, plus one
// Entry added here so two totals tie.
import { desc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/api/board/[name]/route";
import { GET as OG } from "../app/og/[kind]/[id]/route";
import type { Db } from "../db/client";
import { entries, refreshes } from "../db/schema";
import { seed } from "../db/seed/harness";
import { boardPage, listedCampaigns, mapPodiums } from "../db/site";
import type { Campaign } from "../lib/campaigns";
import { tally } from "../lib/podiums";
import { freshDb } from "./pg";

/* Map A (Marble Run), then Map B (Loop de Loop), then Map C (Gone Gully), which has left the
   Workshop. Added to the curated list for this file only, so the board resolves by name. */
const TEST = vi.hoisted((): Campaign => ({
  slug: "test-run",
  title: "Test Run",
  creator: "Tenpin",
  cid: "76561199000000010",
  maps: ["9000000001", "9000000002", "9000000003"],
}));
vi.mock("../lib/campaigns", async (original) => {
  const m = await original<typeof import("../lib/campaigns")>();
  (m.CAMPAIGNS as Array<Campaign>).push(TEST);
  return m;
});

/* the cached reads run uncached outside Next, on this file's database */
const testDb = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("next/cache", () => ({ cacheTag: () => undefined, cacheLife: () => undefined }));
vi.mock("../db/client", async (original) => {
  const { connect } = await original<typeof import("../db/client")>();
  return { connect: (url: string) => testDb.db ?? connect(url) };
});

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const BOARD = "OverallCampaign_test-run";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  // p5 takes 2nd on Map B (6500000), between p10 and p2
  const [{ id }] = await t.db
    .select({ id: refreshes.id })
    .from(refreshes)
    .orderBy(desc(refreshes.id))
    .limit(1);
  await t.db.insert(entries).values({
    board: "Workshop_9000000002",
    steamId: p(5),
    score: 6_500_000,
    ugcId: "9000000005006500000",
    firstSeenRefresh: id,
    lastSeenRefresh: id,
  });
  testDb.db = t.db;
  process.env.DATABASE_URL = t.url;
});
afterAll(() => t.drop());

async function api(query: string) {
  const res = await GET(new Request(`http://site.invalid/api/board/${BOARD}?${query}`), {
    params: Promise.resolve({ name: BOARD }),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("a Campaign's board", () => {
  test("adds up the Circuit's place points over the Campaign's Maps", async () => {
    // Map A: p9 1st (40000), p10 2nd (20000), p1 3rd (13333).
    // Map B: p10 1st (40000), p5 2nd (20000), p2 3rd (13333).
    // Map C has left the Workshop, so p3's time there counts for nothing.
    // p1 and p2 tie on 13333: p1 is on Map A, the Campaign's first Map, so goes first,
    // although a points board on Steam would put the higher Steam ID (p2) first.
    const page = await boardPage(t.db, BOARD, { count: 100 });
    expect(page.total).toBe(5);
    expect(page.rows.map((r) => [r.rank, r.steamId, r.score])).toEqual([
      [1, p(10), 60000],
      [2, p(9), 40000],
      [3, p(5), 20000],
      [4, p(1), 13333],
      [5, p(2), 13333],
    ]);
  });

  test("pages, searches and finds a player through the board API", async () => {
    expect(await api("from=1&count=2")).toMatchObject({
      status: 200,
      body: { total: 5, rows: [{ steamId: p(9) }, { steamId: p(5) }] },
    });
    // "Justy Sparks" is p2: their row keeps its real rank
    expect(await api("q=justy")).toMatchObject({
      status: 200,
      body: { total: 1, rows: [{ rank: 5, steamId: p(2), score: 13333 }] },
    });
    expect(await api(`player=${p(1)}`)).toEqual({
      status: 200,
      body: { rank: 4, score: 13333 },
    });
    expect(await api(`player=${p(3)}`)).toEqual({ status: 200, body: null });
  });

  test("tallies the podiums of the Campaign's Maps", async () => {
    const boards = ["Workshop_9000000001", "Workshop_9000000002"];
    const t3 = tally("Test Run", boards, await mapPodiums(t.db, boards), (b) => b.slice(-1));
    expect(t3.tracks).toBe(2);
    expect(t3.players.map((x) => [x.steamId, x.rank, x.gold, x.silver, x.bronze])).toEqual([
      [p(10), 1, 1, 1, 0],
      [p(9), 2, 1, 0, 0],
      [p(5), 3, 0, 1, 0],
      [p(1), 4, 0, 0, 1],
      [p(2), 4, 0, 0, 1],
    ]);
    expect(t3.players[0].finishes).toEqual([
      { track: "2", rank: 1, score: 6_100_000 },
      { track: "1", rank: 2, score: 4_800_000 },
    ]);
  });

  test("a Campaign that isn't curated is no board", async () => {
    const res = await GET(new Request("http://site.invalid/api/board/OverallCampaign_nope"), {
      params: Promise.resolve({ name: "OverallCampaign_nope" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("the Campaigns to list", () => {
  const one = (slug: string, maps: Array<string>): Campaign => ({ ...TEST, slug, maps });

  test("those with a Map the Workshop lists, by how many players they have, most first", async () => {
    // Map C alone has left the Workshop; Map B alone has p10, p5 and p2; the test Campaign
    // has those and Map A's p9 and p1
    const list = [one("gone", ["9000000003"]), one("small", ["9000000002"]), TEST];
    expect((await listedCampaigns(t.db, list)).map((c) => [c.slug, c.maps, c.players])).toEqual([
      ["test-run", 2, 5],
      ["small", 1, 3],
    ]);
  });

  test("each with its listed Maps' pictures in order and the leader of its board", async () => {
    // Map A has a picture and Map B none; Map C has left the Workshop, so it draws nothing.
    // Tenpin (p10) leads both: 60000 over Maps A and B, 40000 over Map B alone.
    const list = [TEST, one("small", ["9000000003", "9000000002"])];
    const tenpin = {
      steamId: p(10),
      persona: "Tenpin",
      avatar: "https://avatars.example.invalid/10_medium.jpg",
    };
    expect(await listedCampaigns(t.db, list)).toEqual([
      {
        slug: "test-run",
        maps: 2,
        players: 5,
        previews: ["https://images.example.invalid/marble-run.jpg", null],
        leader: { ...tenpin, score: 60000 },
      },
      {
        slug: "small",
        maps: 1,
        players: 3,
        previews: [null],
        leader: { ...tenpin, score: 40000 },
      },
    ]);
  });

  test("equal counts keep the curated order", async () => {
    const list = [one("b", ["9000000002"]), one("a", ["9000000002"])];
    expect((await listedCampaigns(t.db, list)).map((c) => c.slug)).toEqual(["b", "a"]);
  });
});

describe("a Campaign's share image", () => {
  async function og(id: string) {
    return OG(new Request(`http://site.invalid/og/campaign/${id}`), {
      params: Promise.resolve({ kind: "campaign", id }),
    });
  }

  test("is drawn at /og/campaign/<slug>, even with no Map picture to be had", async () => {
    // Marble Run's preview is on a host that doesn't exist, and Loop de Loop has none
    const res = await og("test-run");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  test("is a 404 for a slug that isn't a curated Campaign", async () => {
    expect((await og("nope")).status).toBe(404);
  });
});
