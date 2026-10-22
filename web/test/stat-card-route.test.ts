// GET /og/stats/<steam id>?v=<Refresh time> against the tiny dataset: a player's Stat Card as
// a PNG, kept by the CDN like the share images, and a 404 for a Steam ID that names nobody.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/og/stats/[id]/route";
import type { Db } from "../db/client";
import { seed } from "../db/seed/harness";
import { freshDb } from "./pg";

const testDb = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("next/cache", () => ({ cacheTag: () => undefined, cacheLife: () => undefined }));
vi.mock("../db/client", async (original) => {
  const { connect } = await original<typeof import("../db/client")>();
  return { connect: (url: string) => testDb.db ?? connect(url) };
});

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  testDb.db = t.db;
  process.env.DATABASE_URL = t.url;
  /* tiny's avatars are on example.invalid: answered at once with nothing, as a dead CDN is */
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 404 })));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await t.drop();
});

const card = (id: string) =>
  GET(new Request(`http://site.invalid/og/stats/${id}?v=1`), {
    params: Promise.resolve({ id }),
  });

describe("a Stat Card", () => {
  test("is a 720×1060 PNG for a player, kept by the CDN for a year", async () => {
    // Rolling Rae, who chose Cosmic
    const res = await card("76561199000000001");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("s-maxage=31536000");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([720, 1060]);
  });

  test("a Steam ID that names nobody, or isn't one, is a 404", async () => {
    expect((await card("76561199000000099")).status).toBe(404);
    expect((await card("nope")).status).toBe(404);
  });
});
