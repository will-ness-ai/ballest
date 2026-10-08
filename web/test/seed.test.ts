import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { NOT_PRODUCTION_FLAG, refusal, seed } from "../db/seed/harness";
import * as schema from "../db/schema";
import { freshDb } from "./pg";

const local = "postgres://postgres:postgres@localhost:5432/postgres";
const prod = "postgres://u:p@ep-silent-heart-b8zjdl69.c-14.us-east-1.aws.neon.tech/neondb";
const prodPooled =
  "postgres://u:p@ep-silent-heart-b8zjdl69-pooler.c-14.us-east-1.aws.neon.tech/neondb";
const preview = "postgres://u:p@ep-green-moon-e5f6a7b8-pooler.c-14.us-east-1.aws.neon.tech/neondb";
const known = { PRODUCTION_DB_ENDPOINT: "ep-silent-heart-b8zjdl69" };

describe("refusing production", () => {
  test("a local database is seeded", () => {
    expect(refusal(local, {}, [])).toBeNull();
    expect(refusal("postgres://postgres@127.0.0.1/x", {}, [])).toBeNull();
    expect(refusal(local, known, [])).toBeNull();
  });

  test("a Vercel production deploy is refused whatever the URL", () => {
    expect(refusal(local, { VERCEL_ENV: "production" }, [])).toMatch(/VERCEL_ENV/);
  });

  test("the production endpoint is refused, pooled or direct, flag or not", () => {
    expect(refusal(prod, known, [])).toMatch(/production/);
    expect(refusal(prodPooled, known, [])).toMatch(/production/);
    expect(refusal(prodPooled, known, [NOT_PRODUCTION_FLAG])).toMatch(/production/);
  });

  test("another branch's endpoint is seeded once production's is known", () => {
    expect(refusal(preview, known, [])).toBeNull();
  });

  test("without production's endpoint, a remote database needs the flag", () => {
    expect(refusal(preview, {}, [])).toMatch(/--i-know-this-is-not-production/);
    expect(refusal(prod, {}, [])).toMatch(/--i-know-this-is-not-production/);
    expect(refusal(preview, {}, [NOT_PRODUCTION_FLAG])).toBeNull();
  });

  test("a URL that does not parse is refused", () => {
    expect(refusal("not a url", {}, [])).toMatch(/not a URL/);
  });
});

describe("seeding", () => {
  let t: Awaited<ReturnType<typeof freshDb>>;
  beforeAll(async () => {
    t = await freshDb();
  });
  afterAll(() => t.drop());

  const rows = async () => {
    const { db } = t;
    const counts: Record<string, number> = {};
    for (const [key, table] of Object.entries({
      refreshes: schema.refreshes,
      boards: schema.boards,
      boardReads: schema.boardReads,
      players: schema.players,
      personaHistory: schema.personaHistory,
      entries: schema.entries,
      maps: schema.maps,
      mapHistory: schema.mapHistory,
      dailies: schema.dailies,
    })) {
      const [{ value }] = await db.select({ value: count() }).from(table);
      counts[key] = value;
    }
    return counts;
  };

  const tinyCounts = {
    refreshes: 3,
    boards: 10,
    boardReads: 18,
    players: 10,
    personaHistory: 11,
    entries: 37,
    maps: 3,
    mapHistory: 4,
    dailies: 4,
  };

  test("tiny fills every table, and seeding it again replaces rather than adds", async () => {
    await seed(t.db, "tiny");
    expect(await rows()).toEqual(tinyCounts);
    await seed(t.db, "tiny");
    expect(await rows()).toEqual(tinyCounts);
  });

  test("empty leaves every table empty, refreshes numbered from 1 again after", async () => {
    await seed(t.db, "tiny");
    await seed(t.db, "empty");
    expect(Object.values(await rows()).every((n) => n === 0)).toBe(true);
    await seed(t.db, "tiny");
    const ids = await t.db.select({ id: schema.refreshes.id }).from(schema.refreshes);
    expect(ids.map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });
});
