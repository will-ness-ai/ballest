// `pnpm render:activity-art`: writes the Activity's art to `assets/activity/` (the dev app's,
// tagged DEV, to `assets/activity/dev/`), to upload by hand in the Developer Portal: the icon under
// General Information, the cover and grid-view background under Activities -> Art Assets.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { Renderer } from "../src/render/renderer.js";
import type { ActivityArt } from "../src/render/scenes.js";

const out = "assets/activity";
// Grid view only ever shows the app you launched, so the dev app shares the background.
const art: ReadonlyArray<readonly [ActivityArt, dev: boolean]> = [
  ["icon", false],
  ["cover", false],
  ["background", false],
  ["icon", true],
  ["cover", true],
];

const program = Effect.gen(function* () {
  const renderer = yield* Renderer;
  yield* Effect.tryPromise(() => mkdir(join(out, "dev"), { recursive: true }));
  for (const [name, dev] of art) {
    const png = yield* renderer.activityArt(name, dev);
    yield* Effect.tryPromise(() => writeFile(join(out, dev ? "dev" : "", `${name}.png`), png));
  }
  yield* Effect.log(`wrote the Activity's art to ${out}`);
});

Effect.runPromise(program.pipe(Effect.provide(Renderer.Default)));
