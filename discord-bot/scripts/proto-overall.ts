/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE (never merge): renders round N of the overall-score variants from a saved
// GET /api/standings payload (.logs/proto/st.json) into .logs/proto/.
import { readFileSync, writeFileSync } from "node:fs";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { BOARD_TITLE, dayTitle } from "../src/report/messages.js";
import { STATS } from "../src/report/report.js";
import { Renderer } from "../src/render/renderer.js";
import {
  PROTO_C_WIDTH,
  PROTO_E_WIDTH,
  type ProtoOverallRow,
  protoA,
  protoB,
  protoC,
  protoE,
  STANDINGS_WIDTH,
  type StandingsImage,
  standingsScene,
} from "../src/render/scenes.js";

type Row = [player: number, n: number, nBefore: number, place: number, placeBefore: number];
const payload = JSON.parse(readFileSync(".logs/proto/st.json", "utf8")) as {
  maps: number;
  players: Array<[string, string]>;
  lists: Record<string, Array<Row>>;
};
const P = payload.players;
const TOP = 10;
const wasTop = (r: Row) => r[2] > 0 && r[4] <= TOP;
const boards = STATS.map((stat) => {
  const list = payload.lists[stat] ?? [];
  return {
    title: BOARD_TITLE[stat],
    rows: list
      .filter((r) => r[1] > 0)
      .slice(0, TOP)
      .map((r) => ({
        steamId: P[r[0]]![0],
        skin: null,
        name: P[r[0]]![1],
        n: r[1],
        place: r[3],
        move: wasTop(r) ? r[4] - r[3] : ("new" as const),
        gain: r[1] - r[2],
      })),
    out: list.filter((r) => wasTop(r) && (r[1] === 0 || r[3] > TOP)).map((r) => P[r[0]]![1]),
  };
});
const players = payload.lists.played!.filter((r) => r[1] > 0).length;
const image: StandingsImage = {
  title: dayTitle(Date.now()),
  subtitle: `Workshop standings · ${payload.maps.toLocaleString("en")} Workshop Maps · ${players.toLocaleString("en")} players`,
  boards,
};

// Points: 11 - place for a top-10 place on each standing, now and 24 hours before.
const now = new Map<number, number>();
const then = new Map<number, number>();
const places = new Map<number, Array<number | null>>();
STATS.forEach((stat, i) => {
  for (const r of payload.lists[stat] ?? []) {
    if (r[1] > 0 && r[3] <= TOP) {
      now.set(r[0], (now.get(r[0]) ?? 0) + 11 - r[3]);
      const p = places.get(r[0]) ?? [null, null, null, null];
      p[i] = r[3];
      places.set(r[0], p);
    }
    if (wasTop(r)) then.set(r[0], (then.get(r[0]) ?? 0) + 11 - r[4]);
  }
});
const shared = (m: Map<number, number>) => {
  const placeOf = new Map<number, number>();
  for (const [p, pts] of m) placeOf.set(p, 1 + [...m.values()].filter((v) => v > pts).length);
  return placeOf;
};
const placeNow = shared(now);
const placeThen = shared(then);
const overall: Array<ProtoOverallRow> = [...now.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP)
  .map(([p, pts]) => {
    const before = placeThen.get(p);
    const place = placeNow.get(p)!;
    return {
      steamId: P[p]![0],
      skin: null,
      name: P[p]![1],
      points: pts,
      place,
      move: before === undefined || before > TOP ? ("new" as const) : before - place,
      places: places.get(p)!,
    };
  });

const text = [
  "## 🏅 Overall",
  "-# 10 points for 1st on a standing down to 1 for 10th, added across all four",
  ...overall.map(
    (r) =>
      `${r.place}. **${r.name}** — ${r.points} pts · *${r.places.map((x, i) => `${["MP", "AM", "WR", "T5"][i]} ${x ?? "–"}`).join(" · ")}*`,
  ),
].join("\n");
writeFileSync(".logs/proto/D.md", text);
console.log(text);

NodeRuntime.runMain(
  Effect.gen(function* () {
    const r = yield* Renderer;
    const save = (name: string, png: Buffer) =>
      Effect.sync(() => writeFileSync(`.logs/proto/${name}.png`, png));
    yield* save("today", yield* r.standings(image));
    yield* save("A", yield* r.proto((pics) => protoA(image, overall, pics), STANDINGS_WIDTH));
    yield* save("B", yield* r.proto((pics) => protoB(image, overall, pics), STANDINGS_WIDTH));
    yield* save("C", yield* r.proto((pics) => protoC(image, overall, pics), PROTO_C_WIDTH));
    yield* save("E", yield* r.proto((pics) => protoE(image, overall, pics), PROTO_E_WIDTH));
  }).pipe(Effect.provide(Renderer.Default), Effect.scoped),
);
