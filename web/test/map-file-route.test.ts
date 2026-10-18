// GET /map/<pfid>/file?v=<version> against the tiny dataset: a Map's stored file, for its 3D
// view (components/workshop/Map3D). Marble Run's file is in tiny; Loop de Loop's isn't.
import { gunzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { GET } from "../app/map/[pfid]/file/route";
import type { Db } from "../db/client";
import { TINY_MAP_FILE, TINY_MAP_VERSION } from "../db/seed/datasets/tiny";
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
});
afterAll(() => t.drop());

const file = (pfid: string, v?: string) =>
  GET(new Request(`http://site.invalid/map/${pfid}/file` + (v === undefined ? "" : `?v=${v}`)), {
    params: Promise.resolve({ pfid }),
  });

describe("a Map's file", () => {
  test("comes back as the stored gzip bytes, for the browser to unpack", async () => {
    const res = await file("9000000001", TINY_MAP_VERSION);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = Buffer.from(await res.arrayBuffer());
    expect(gunzipSync(body).equals(TINY_MAP_FILE)).toBe(true);
  });

  test("is cached for a year under the version it is", async () => {
    const res = await file("9000000001", TINY_MAP_VERSION);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
  });

  test("asked for under another version, or none, is the current file for a minute", async () => {
    for (const v of ["1234", undefined]) {
      const res = await file("9000000001", v);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(gunzipSync(Buffer.from(await res.arrayBuffer())).equals(TINY_MAP_FILE)).toBe(true);
    }
  });

  test("a Map whose file hasn't been read is a 404", async () => {
    expect((await file("9000000002", "1")).status).toBe(404);
  });

  test("an ID nobody published, or not shaped like one, is a 404", async () => {
    expect((await file("9999999999")).status).toBe(404);
    expect((await file("abc")).status).toBe(404);
  });
});
