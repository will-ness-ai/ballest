// GET /og/stats/<steam id>?v=<Refresh time> against the tiny dataset: a player's Stat Card as
// a PNG, kept by the CDN for minutes (never, when a picture it should have failed), and a 404
// for a Steam ID that names nobody.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  avatars(false);
});

/* tiny's avatars are on example.invalid: each answered at once, with a picture (one of the
   Skin PNGs) or with nothing, as a dead CDN is. Anything else (next/og's own files) is
   fetched as it would be */
const AVATAR = readFile(join(import.meta.dirname, "../assets/share/skins/DA_Skin_Pink.png"));
const realFetch = globalThis.fetch;
function avatars(up: boolean) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input instanceof Request ? input.url : input).includes("example.invalid"))
      return realFetch(input, init);
    return up
      ? new Response(await AVATAR, { headers: { "content-type": "image/png" } })
      : new Response(null, { status: 404 });
  });
}
afterAll(async () => {
  vi.unstubAllGlobals();
  await t.drop();
});

const card = (id: string) =>
  GET(new Request(`http://site.invalid/og/stats/${id}?v=1`), {
    params: Promise.resolve({ id }),
  });

describe("a Stat Card", () => {
  test("is a 720×1060 PNG for a player, kept by the CDN for five minutes", async () => {
    // Rolling Rae, who chose Cosmic
    avatars(true);
    const res = await card("76561199000000001");
    avatars(false);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([720, 1060]);
  });

  test("drawn without the avatar it should have had, is never kept", async () => {
    const res = await card("76561199000000001");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a Steam ID that names nobody, or isn't one, is a 404", async () => {
    expect((await card("76561199000000099")).status).toBe(404);
    expect((await card("nope")).status).toBe(404);
  });
});
