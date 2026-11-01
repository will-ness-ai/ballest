// PROTOTYPE (grill-design, colour-coded standings): draws the Daily Report's standings image from
// the live site's standings once per variant, into .logs/proto/<variant>.png. Never merged.
// Round 2 swaps Most top 5s for Most Daily wins and adds yesterday's Daily, both read from
// .logs/proto/daily.json (scraped from the live site's Daily pages by hand).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Clock, Effect, Layer } from "effect";
import { Renderer } from "../src/render/renderer.js";
import {
  PROTO2_VARIANTS,
  type ProtoDaily,
  setProto2Variant,
  setProtoDaily,
  setProtoVariant,
} from "../src/render/scenes.js";
import { standingsImage } from "../src/report/messages.js";
import { buildReport, DAY_MS, type SiteStanding } from "../src/report/report.js";
import { StandingsSource, StandingsSourceLive } from "../src/report/standings.js";

interface Scraped {
  title: string;
  date: string;
  players: number;
  picture: string;
  rows: Array<{ place: number; name: string; time: string }>;
  wins: Array<{ name: string; n: number }>;
}

const seconds = (t: string) => {
  const [m, s] = t.split(":");
  return Number(m) * 60 + Number(s);
};

/** Shared places: 1 + the players with strictly more. */
const placed = (ns: ReadonlyArray<number>) => ns.map((n) => 1 + ns.filter((m) => m > n).length);

const program = Effect.gen(function* () {
  const at = yield* Clock.currentTimeMillis;
  const standings = yield* (yield* StandingsSource).read(at - DAY_MS);
  const scraped = JSON.parse(
    yield* Effect.promise(() => readFile(".logs/proto/daily.json", "utf8")),
  ) as Scraped;
  const ids = new Map<string, string>();
  for (const list of Object.values(standings)) for (const s of list) ids.set(s.persona, s.steamId);
  const idOf = (name: string) => ids.get(name) ?? `proto-${name}`;
  // Sparro won yesterday's Daily, so had one fewer win 24 hours before.
  const winner = scraped.rows[0]?.name;
  const now = scraped.wins.map((w) => w.n);
  const before = scraped.wins.map((w) => (w.name === winner ? w.n - 1 : w.n));
  const placesNow = placed(now);
  const placesBefore = placed(before);
  const wins: Array<SiteStanding> = scraped.wins
    .map((w, i) => ({
      steamId: idOf(w.name),
      persona: w.name,
      n: w.n,
      nBefore: before[i] ?? w.n,
      place: placesNow[i] ?? 99,
      placeBefore: placesBefore[i] ?? 99,
    }))
    .filter((w) => w.place <= 10 || w.placeBefore <= 10);
  const report = buildReport(
    { maps: [], entries: [], tracks: [], refreshedAt: null },
    { ...standings, top5: wins },
    at,
  );
  const base = standingsImage(report, new Map());
  const image = {
    ...base,
    subtitle: "Workshop standings · live from ballestrecords.com",
    boards: base.boards.map((b, i) => (i === 3 ? { ...b, title: "Most Daily wins" } : b)),
  };
  const first = seconds(scraped.rows[0]?.time ?? "0:0");
  const daily: ProtoDaily = {
    title: scraped.title,
    date: scraped.date,
    players: scraped.players,
    picture: scraped.picture,
    rows: scraped.rows.map((r) => ({
      ...r,
      steamId: idOf(r.name),
      skin: null,
      gap: r.place === 1 ? null : `+${(seconds(r.time) - first).toFixed(3)}`,
    })),
  };
  setProtoDaily(daily);
  setProtoVariant("A");
  const renderer = yield* Renderer;
  yield* Effect.promise(() => mkdir(".logs/proto/r2", { recursive: true }));
  for (const [key] of PROTO2_VARIANTS) {
    setProto2Variant(key);
    const png = yield* renderer.standings(image);
    yield* Effect.promise(() => writeFile(`.logs/proto/r2/${key}.png`, png));
  }
  yield* Effect.logInfo("wrote .logs/proto/r2");
});

program.pipe(
  Effect.provide(Layer.mergeAll(StandingsSourceLive, Renderer.Default)),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
