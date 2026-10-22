// GET /og/stats/<steam id>?v=<Refresh time> against the tiny dataset: a player's Stat Card as
// a PNG, kept by the CDN for minutes (never, when its avatar failed only for now), and a 404
// for a Steam ID that names nobody.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/og/stats/[id]/route";
import { drawStatCard } from "../components/share/StatCard";
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
  avatars("404");
});

/* tiny's avatars are on example.invalid: each answered at once, with a picture (one of the
   Skin PNGs), a 404 (gone for good), a 503 (a CDN down for now) or no answer at all (the
   network failing). Anything else (next/og's own files) is fetched as it would be */
const AVATAR = readFile(join(import.meta.dirname, "../assets/share/skins/DA_Skin_Pink.png"));
const realFetch = globalThis.fetch;
function avatars(cdn: "up" | "404" | "503" | "down") {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input instanceof Request ? input.url : input).includes("example.invalid"))
      return realFetch(input, init);
    if (cdn === "down") throw new TypeError("fetch failed");
    return cdn === "up"
      ? new Response(await AVATAR, { headers: { "content-type": "image/png" } })
      : new Response(null, { status: Number(cdn) });
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
    avatars("up");
    const res = await card("76561199000000001");
    avatars("404");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([720, 1060]);
  });

  test("drawn without an avatar that failed for now, is never kept", async () => {
    for (const cdn of ["503", "down"] as const) {
      avatars(cdn);
      const res = await card("76561199000000001");
      expect(res.status, cdn).toBe(200);
      expect(res.headers.get("cache-control"), cdn).toBe("no-store");
    }
    avatars("404");
  });

  test("drawn without a picture that will never load, is kept as usual", async () => {
    // the avatar is gone (a 404)
    const gone = await card("76561199000000001");
    expect(gone.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    // a Skin with no PNG, and an avatar address safeImg refuses
    const res = await drawStatCard({
      name: "Rae",
      hue: 96,
      skin: "DA_Skin_No_Such",
      avatar: "http://example.invalid/a_medium.jpg",
      rows: [],
      date: "22 OCT 2026",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
  });

  test("a Steam ID that names nobody, or isn't one, is a 404", async () => {
    expect((await card("76561199000000099")).status).toBe(404);
    expect((await card("nope")).status).toBe(404);
  });
});
