// GET /api/board/<name>?player=<steam id> against the tiny dataset: one player's rank and
// score on a board, the read the banner above a board makes for You. Expected values come
// from the comments in db/seed/datasets/tiny.ts (Map_Track13's order is in site.test.ts).
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/api/board/[name]/route";
import type { Db } from "../db/client";
import { seed } from "../db/seed/harness";
import { freshDb } from "./pg";

/* the cached reads run uncached outside Next, on this file's database */
const testDb = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("next/cache", () => ({ cacheTag: () => undefined, cacheLife: () => undefined }));
vi.mock("../db/client", async (original) => {
  const { connect } = await original<typeof import("../db/client")>();
  return { connect: (url: string) => testDb.db ?? connect(url) };
});

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  testDb.db = t.db;
  process.env.DATABASE_URL = t.url;
});
afterAll(() => t.drop());

async function playerOn(name: string, id: string) {
  const res = await GET(
    new Request(`http://site.invalid/api/board/${name}?player=${encodeURIComponent(id)}`),
    { params: Promise.resolve({ name }) },
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("one player's row on a board", () => {
  test("a player on a Track gets their rank and score", async () => {
    expect(await playerOn("Map_Track13", p(5))).toEqual({
      status: 200,
      body: { rank: 3, score: 1_019_884 },
    });
  });

  test("a player on a Map gets theirs", async () => {
    expect(await playerOn("Workshop_9000000001", p(1))).toEqual({
      status: 200,
      body: { rank: 3, score: 5_000_000 },
    });
  });

  test("a player on a points board gets their points", async () => {
    expect(await playerOn("OverallLeaderboard_EASeason2", p(2))).toEqual({
      status: 200,
      body: { rank: 3, score: 1200 },
    });
  });

  test("a known player with no Entry on the board is no row", async () => {
    expect(await playerOn("Map_Track13", p(3))).toEqual({ status: 200, body: null });
  });

  test("a Steam ID nobody raced under is no row", async () => {
    expect(await playerOn("Map_Track13", "76561199999999999")).toEqual({
      status: 200,
      body: null,
    });
  });

  test("something that is not a Steam ID is refused", async () => {
    expect((await playerOn("Map_Track13", "abc")).status).toBe(400);
  });

  test("a board that doesn't exist is a 404", async () => {
    expect((await playerOn("Map_Nope", p(5))).status).toBe(404);
  });
});
