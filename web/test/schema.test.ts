import { afterAll, beforeAll, expect, test } from "vitest";

import { boards, entries, players, refreshes } from "../db/schema";
import { freshDb } from "./pg";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.drop());

test("a player holds at most one open Entry per board, and any number of closed ones", async () => {
  const { db } = t;
  const [r1] = await db
    .insert(refreshes)
    .values({ startedAt: new Date(), source: "collector" })
    .returning();
  await db.insert(boards).values({
    name: "Map_Track13",
    kind: "track",
    season: "Season 1",
    display: "Track 13",
    scoresPoints: false,
  });
  await db.insert(players).values({ steamId: "76561198259485267", persona: "Hky." });
  const entry = {
    board: "Map_Track13",
    steamId: "76561198259485267",
    firstSeenRefresh: r1.id,
    lastSeenRefresh: r1.id,
  };
  await db.insert(entries).values({ ...entry, score: 1_100_000, closedRefresh: r1.id });
  await db.insert(entries).values({ ...entry, score: 1_013_307 });
  await expect(db.insert(entries).values({ ...entry, score: 1_000_000 })).rejects.toThrow();
  expect(await db.select().from(entries)).toHaveLength(2);
});
