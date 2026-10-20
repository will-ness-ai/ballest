import { afterAll, beforeAll, expect, test } from "vitest";

import { readHomepageActivity } from "../db/home-activity";
import { boards, mapHistory, maps, refreshes } from "../db/schema";
import { freshDb } from "./pg";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const at = (day: number) => new Date(Date.UTC(2026, 9, day));

test("does not invent activity before a baseline exists, and uses first observations of unchanged history", async () => {
  expect(await readHomepageActivity(t.db)).toEqual({ asOf: 0, metrics: {} });
  const r = await t.db
    .insert(refreshes)
    .values([1, 9, 10, 11, 12].map((day) => ({ startedAt: at(day), source: "collector" as const })))
    .returning();
  const ids = ["active", "unchanged", "new", "discovered", "reset", "missing", "gone"];
  await t.db.insert(boards).values(
    ids.map((pfid) => ({
      name: pfid,
      kind: "map" as const,
      display: pfid,
      scoresPoints: false,
    })),
  );
  await t.db.insert(maps).values(
    ids.map((pfid) => ({
      pfid,
      board: pfid,
      createdAt: at(pfid === "new" ? 11 : 1),
    })),
  );
  const history = (pfid: string, sessions: number | null, first: number, last = first) => ({
    pfid,
    title: pfid,
    sessions,
    firstSeenRefresh: r[first].id,
    lastSeenRefresh: r[last].id,
  });
  await t.db.insert(mapHistory).values([
    history("active", 100, 0),
    history("active", 125, 1),
    history("active", 145, 3),
    history("active", 155, 4),
    // last_seen is after both cutoffs, but its value was already observed before them.
    history("unchanged", 200, 0, 4),
    history("new", 12, 3),
    history("new", 20, 4),
    // Newly catalogued old Maps cannot contribute lifetime sessions as window growth.
    history("discovered", 500, 4),
    history("reset", 100, 0),
    history("reset", 1, 4),
    history("missing", null, 4),
    history("gone", 1000, 0),
  ]);
  expect(await readHomepageActivity(t.db)).toEqual({
    asOf: at(12).getTime(),
    metrics: {
      active: { day: 10, week: 55 },
      unchanged: { day: 0, week: 0 },
      new: { day: 8, week: 20 },
      discovered: { day: null, week: null },
      reset: { day: null, week: null },
      missing: { day: null, week: null },
    },
  });
});
