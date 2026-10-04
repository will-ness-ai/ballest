// A board's Score history against the tiny dataset; every expected value comes from the
// comments in db/seed/datasets/tiny.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { scoreHistory } from "../db/reads";
import { seed } from "../db/seed/harness";
import { freshDb } from "./pg";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
});
afterAll(() => t.drop());

describe("a board's Score history", () => {
  const r1 = "2026-09-01T00:00:00.000Z";
  const r2 = "2026-09-01T03:00:00.000Z";
  const r3 = "2026-09-01T06:00:00.000Z";

  test("every Entry, open and closed, in the order they were first seen", async () => {
    const history = await scoreHistory(t.db, "Map_Track13");
    expect(
      history?.map((e) => [e.steamId, e.score, e.firstSeenAt, e.lastSeenAt, e.closedAt]),
    ).toEqual([
      [p(1), 1_050_000, r1, r1, r2],
      [p(2), 1_019_884, r1, r3, null],
      [p(3), 1_023_276, r1, r2, r3],
      [p(4), 1_100_000, r1, r3, null],
      [p(7), 1_100_000, r1, r3, null],
      [p(1), 1_013_307, r2, r3, null],
      [p(5), 1_019_884, r2, r3, null],
      [p(6), 1_200_000, r3, r3, null],
    ]);
    expect(history?.[0].persona).toBe("Rolling Rae");
  });

  test("an unknown board is null", async () => {
    expect(await scoreHistory(t.db, "Map_Nope")).toBeNull();
  });
});
