// PROTOTYPE round 3 (never merged): draws the posted 11-02 report's standings image
// (argv[2], report-image-data.ts's JSON) once per variant into .logs/proto/<key>.png.
import { readFileSync, writeFileSync } from "node:fs";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { MapPreviews, PreviewSourceLive, previewUri } from "../src/previews.js";
import { Renderer } from "../src/render/renderer.js";
import { PROTO_VARIANTS, setProtoVariant } from "../src/render/scenes.js";

const { preview: url, image } = JSON.parse(readFileSync(process.argv[2] as string, "utf8"));

const program = Effect.gen(function* () {
  const preview =
    url === null
      ? null
      : Option.getOrNull(Option.map(yield* (yield* MapPreviews).of(url), previewUri));
  for (const [key] of PROTO_VARIANTS) {
    setProtoVariant(key);
    const png = yield* (yield* Renderer).standings({
      ...image,
      daily: image.daily === null ? null : { ...image.daily, preview },
    });
    writeFileSync(`.logs/proto/${key}.png`, png);
    yield* Effect.logInfo(`wrote ${key}`);
  }
});

program.pipe(
  Effect.provide(
    Layer.mergeAll(Renderer.Default, MapPreviews.Default.pipe(Layer.provide(PreviewSourceLive))),
  ),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
