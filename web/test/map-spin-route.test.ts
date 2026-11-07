// GET /map/<pfid>/spin?v=<drawn at>: a Map's spinning 3D GIF from map_spins, which Multiballs
// links on the Weekly Cup's Shortlist instead of uploading it (ten GIFs of 2-5 MB each are more
// than one Discord message takes). Marble Run gets a drawing here; Loop de Loop has none.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/map/[pfid]/spin/route";
import type { Db } from "../db/client";
import { mapSpins } from "../db/schema";
import { seed } from "../db/seed/harness";
import { freshDb } from "./pg";

const testDb = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("next/cache", () => ({ cacheTag: () => undefined, cacheLife: () => undefined }));
vi.mock("../db/client", async (original) => {
  const { connect } = await original<typeof import("../db/client")>();
  return { connect: (url: string) => testDb.db ?? connect(url) };
});

const GIF = Buffer.from("GIF89a a spinning Map");
const DRAWN_AT = new Date("2026-11-05T12:00:00.000Z");

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
  await t.db
    .insert(mapSpins)
    .values({ pfid: "9000000001", version: "7", gif: GIF, drawnAt: DRAWN_AT });
  testDb.db = t.db;
  process.env.DATABASE_URL = t.url;
});
afterAll(() => t.drop());

const spin = (pfid: string, v?: string) =>
  GET(new Request(`http://site.invalid/map/${pfid}/spin` + (v === undefined ? "" : `?v=${v}`)), {
    params: Promise.resolve({ pfid }),
  });

describe("a Map's spinning GIF", () => {
  test("comes back as the stored GIF", async () => {
    const res = await spin("9000000001", String(DRAWN_AT.getTime()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(Buffer.from(await res.arrayBuffer()).equals(GIF)).toBe(true);
  });

  test("is cached for a year under the drawing it is", async () => {
    const res = await spin("9000000001", String(DRAWN_AT.getTime()));
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
  });

  test("asked for under another drawing, or none, is the current one for a minute", async () => {
    for (const v of ["1234", undefined]) {
      const res = await spin("9000000001", v);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(Buffer.from(await res.arrayBuffer()).equals(GIF)).toBe(true);
    }
  });

  test("a Map never drawn, or an ID not shaped like one, is a 404", async () => {
    expect((await spin("9000000002")).status).toBe(404);
    expect((await spin("abc")).status).toBe(404);
  });
});
