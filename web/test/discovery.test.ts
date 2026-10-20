import { expect, test } from "vitest";
import { discoveryPicks, type HomeActivity } from "../lib/discovery";
import type { MapCard } from "../lib/workshop";
const NOW = Date.UTC(2026, 9, 20),
  DAY = 86400000;
const map = (i: number, days: number): MapCard => ({
  pfid: String(i),
  title: "Map " + String(i),
  creator: "Maker",
  cid: null,
  preview: null,
  created: (NOW - days * DAY) / 1000,
  author: 20,
  entryCount: 10,
  sessions: 1000 - i,
  top3: [["76561199000000001", "Player", 1000000]],
  gap13: null,
  crowd: 1,
  authorBeaten: 1,
});
const activity = (maps: ReadonlyArray<MapCard>): HomeActivity => ({
  asOf: NOW,
  metrics: Object.fromEntries(maps.map((m, i) => [m.pfid, { day: i, week: i }])),
});
test("trending uses recent gains and excludes all-time winners outside the freshness pool", () => {
  const maps = [map(1, 60), map(2, 5), map(3, 2)];
  const a = activity(maps);
  a.metrics["1"] = { day: 0, week: 999 };
  a.metrics["2"] = { day: 0, week: 3 };
  a.metrics["3"] = { day: 0, week: 20 };
  expect(discoveryPicks(maps, a, "A", NOW).map((p) => p.m.pfid)).toEqual(["3", "2"]);
});
test("unknown baselines are fallback picks, never fake recent activity", () => {
  const maps = [map(1, 10), map(2, 1)];
  const picks = discoveryPicks(maps, { asOf: NOW, metrics: {} }, "A", NOW);
  expect(picks.map((p) => p.m.pfid)).toEqual(["2", "1"]);
  expect(picks.every((p) => p.recent === null && p.fallback)).toBe(true);
});
test("daily discovery rotates all twenty candidates in four days without duplicates", () => {
  const maps = Array.from({ length: 20 }, (_, i) => map(i, 2));
  const a = activity(maps);
  const groups = Array.from({ length: 4 }, (_, i) =>
    discoveryPicks(maps, a, "E", NOW + i * DAY).map((p) => p.m.pfid),
  );
  expect(groups.every((g) => g.length === 5 && new Set(g).size === 5)).toBe(true);
  expect(new Set(groups.flat()).size).toBe(20);
});
test("sparse discovery and newest-with-times handle one map and unfinished maps", () => {
  const maps = [map(1, 1), { ...map(2, 0), top3: [] }];
  expect(discoveryPicks(maps, activity(maps), "E", NOW)).toHaveLength(1);
  expect(
    discoveryPicks([{ ...map(3, 0), entryCount: 1 }, ...maps], activity(maps), "D", NOW).map(
      (p) => p.m.pfid,
    ),
  ).toEqual(["1"]);
});
