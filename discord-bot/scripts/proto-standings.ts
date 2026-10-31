// PROTOTYPE (grill-design, colour-coded standings): draws the Daily Report's standings image from
// the live site's standings once per variant, into .logs/proto/<variant>.png. Never merged.
import { mkdir, writeFile } from "node:fs/promises";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Clock, Effect, Layer } from "effect";
import { Renderer } from "../src/render/renderer.js";
import { PROTO_VARIANTS, setProtoVariant } from "../src/render/scenes.js";
import { standingsImage } from "../src/report/messages.js";
import { buildReport, DAY_MS } from "../src/report/report.js";
import { StandingsSource, StandingsSourceLive } from "../src/report/standings.js";

const program = Effect.gen(function* () {
  const at = yield* Clock.currentTimeMillis;
  const standings = yield* (yield* StandingsSource).read(at - DAY_MS);
  const report = buildReport(
    { maps: [], entries: [], tracks: [], refreshedAt: null },
    standings,
    at,
  );
  const image = {
    ...standingsImage(report, new Map()),
    subtitle: "Workshop standings · live from ballestrecords.com",
  };
  const renderer = yield* Renderer;
  yield* Effect.promise(() => mkdir(".logs/proto", { recursive: true }));
  for (const [key] of PROTO_VARIANTS) {
    setProtoVariant(key);
    const png = yield* renderer.standings(image);
    yield* Effect.promise(() => writeFile(`.logs/proto/${key}.png`, png));
  }
  yield* Effect.logInfo("wrote .logs/proto");
});

program.pipe(
  Effect.provide(Layer.mergeAll(StandingsSourceLive, Renderer.Default)),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
