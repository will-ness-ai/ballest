// Turns a scene into a PNG: Satori lays it out to SVG with the bundled fonts, resvg rasterises it
// at twice the layout size so it stays sharp on high-density screens. Pure apart from reading
// the font files once at startup.
//
// Rasterising runs on a worker thread (rasterise.worker.mjs), about a second a Card, so the bot
// keeps answering clicks and the Activity meanwhile. The worker uses resvg's WebAssembly build
// and frees every image: the native build (@resvg/resvg-js) never freed what `render()` returns,
// and that once ran production out of memory.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { Data, Effect } from "effect";
import satori, { type Font } from "satori";
import type { Improvement, ProfilePreview } from "../ports.js";
import { marbleSvg } from "./art.js";
import {
  ACTIVITY_ART_SIZE,
  type ActivityArt,
  activityArtScene,
  CARD_WIDTH,
  cardScene,
  type CardImage,
  type El,
  FOOTER_WIDTH,
  footerScene,
  improvementScene,
  LINK_WIDTH,
  linkScene,
  PROGRESSION_WIDTH,
  type ProgressionImage,
  progressionScene,
  ROW_WIDTH,
  STANDINGS_WIDTH,
  type StandingsImage,
  standingsScene,
} from "./scenes.js";

/** An image that couldn't be drawn: a font, layout or rasterising failure. */
export class RenderError extends Data.TaggedError("RenderError")<{ readonly cause: unknown }> {}

const SCALE = 2;

type Weight = 400 | 500 | 600 | 700 | 800 | 900;

/**
 * Every face the scenes use, from the @fontsource packages. Satori keeps one font per name and
 * weight, and for a glyph its family lacks it tries every other loaded font; so each extra file
 * (latin-ext, and the Japanese chunks for names in Japanese script) gets a name of its own.
 */
const FACES: ReadonlyArray<readonly [name: string, pkg: string, weight: Weight]> = [
  ["Nunito", "nunito", 800],
  ["Nunito", "nunito", 900],
  ["Chakra Petch", "chakra-petch", 500],
  ["Chakra Petch", "chakra-petch", 600],
  ["Chakra Petch", "chakra-petch", 700],
  ["Archivo", "archivo", 400],
  ["Archivo", "archivo", 600],
  ["Archivo", "archivo", 700],
  ["Bungee", "bungee", 400],
];

const loadFonts = Effect.fn("loadFonts")(function* () {
  const require = createRequire(import.meta.url);
  const fonts: Array<Font> = [];
  for (const [name, pkg, weight] of FACES)
    for (const subset of ["latin", "latin-ext"]) {
      const path = require.resolve(
        `@fontsource/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff`,
      );
      const data = yield* Effect.tryPromise({
        try: () => readFile(path),
        catch: (cause) => new RenderError({ cause }),
      });
      fonts.push({
        name: subset === "latin" ? name : `${name} ${subset}`,
        data,
        weight,
        style: "normal",
      });
    }
  // Names in Japanese script (and the kanji Chinese names share) fall back to Noto Sans JP, which
  // @fontsource ships in unicode-range chunks; one weight covers every place a name appears.
  const jpDir = dirname(
    require.resolve("@fontsource/noto-sans-jp/files/noto-sans-jp-0-700-normal.woff"),
  );
  const jpFiles = yield* Effect.tryPromise({
    try: () => readdir(jpDir),
    catch: (cause) => new RenderError({ cause }),
  });
  for (const file of jpFiles.filter((f) => f.endsWith("-700-normal.woff"))) {
    const data = yield* Effect.tryPromise({
      try: () => readFile(join(jpDir, file)),
      catch: (cause) => new RenderError({ cause }),
    });
    fonts.push({ name: `Noto Sans JP ${file}`, data, weight: 700, style: "normal" });
  }
  return fonts;
});

interface Rasterised {
  readonly id: number;
  readonly png?: Uint8Array;
  readonly error?: string;
}

/** A draw that takes this long is given up, and its worker replaced: a Card takes about a second. */
const RASTERISE_TIMEOUT = "30 seconds";

/**
 * The rasteriser's worker thread, started on the first draw and again if it ever dies, stopped
 * with the Renderer. Each draw waits for its own PNG; one that never comes back times out, and
 * the stuck worker is stopped, which fails every draw still waiting on it.
 */
const makeRasteriser = Effect.gen(function* () {
  const waiting = new Map<number, (result: Effect.Effect<Buffer, RenderError>) => void>();
  let next = 0;
  let worker: Worker | null = null;
  const failWaiting = (cause: unknown) => {
    for (const resume of waiting.values()) resume(Effect.fail(new RenderError({ cause })));
    waiting.clear();
  };
  const start = () => {
    const started = new Worker(new URL("./rasterise.worker.mjs", import.meta.url));
    started.on("message", ({ id, png, error }: Rasterised) => {
      const resume = waiting.get(id);
      waiting.delete(id);
      resume?.(
        png === undefined
          ? Effect.fail(new RenderError({ cause: error }))
          : Effect.succeed(Buffer.from(png)),
      );
    });
    // A worker that failed or stopped takes no more draws; the next draw starts a fresh one.
    const retire = (cause: unknown) => {
      if (worker === started) worker = null;
      failWaiting(cause);
    };
    started.on("error", (cause) => retire(cause));
    started.on("exit", () => retire("the rasteriser stopped"));
    return started;
  };
  const stop = Effect.promise(async () => {
    await worker?.terminate();
  });
  yield* Effect.addFinalizer(() => stop);
  return Effect.fn("rasterise")(function* (svg: string) {
    return yield* Effect.async<Buffer, RenderError>((resume) => {
      const id = next++;
      try {
        worker ??= start();
        worker.postMessage({ id, svg, scale: SCALE });
        // The answer can't arrive before this tick ends, so waiting after posting is safe.
        waiting.set(id, resume);
      } catch (cause) {
        resume(Effect.fail(new RenderError({ cause })));
      }
      return Effect.sync(() => waiting.delete(id));
    }).pipe(
      Effect.timeout(RASTERISE_TIMEOUT),
      Effect.catchTag("TimeoutException", () =>
        stop.pipe(
          Effect.zipRight(
            Effect.fail(new RenderError({ cause: `rasterising took over ${RASTERISE_TIMEOUT}` })),
          ),
        ),
      ),
    );
  });
});

export class Renderer extends Effect.Service<Renderer>()("multiballs/Renderer", {
  scoped: Effect.gen(function* () {
    const rasterise = yield* makeRasteriser;
    // Without its fonts or its rasteriser the bot can draw nothing: that stops it at startup.
    const fonts = yield* loadFonts().pipe(Effect.orDie);
    yield* rasterise(marbleSvg(0, 8)).pipe(Effect.orDie);
    const draw = Effect.fn("draw")(function* (scene: El, width: number) {
      const svg = yield* Effect.tryPromise({
        try: () => satori(scene, { width, fonts }),
        catch: (cause) => new RenderError({ cause }),
      });
      return yield* rasterise(svg);
    });
    const footer = yield* Effect.cached(draw(footerScene(), FOOTER_WIDTH));

    return {
      /** The Match Card, in any state. */
      card: (card: CardImage) => draw(cardScene(card), CARD_WIDTH),
      improvement: (improvement: Improvement, name: string) =>
        draw(improvementScene(improvement, name), ROW_WIDTH),
      footer,
      link: (preview: ProfilePreview) => draw(linkScene(preview), LINK_WIDTH),
      /** After the Result: every PB of the Match over its clock. */
      progression: (image: ProgressionImage) => draw(progressionScene(image), PROGRESSION_WIDTH),
      /** The Activity's art for the Developer Portal; `dev` tags it for the dev app. */
      activityArt: (art: ActivityArt, dev: boolean) =>
        draw(activityArtScene(art, dev), ACTIVITY_ART_SIZE[art][0]),
      /** A bare marble, for the lifecycle-line emojis. */
      marble: (hue: number) => rasterise(marbleSvg(hue, 64)),
      /** The Daily Report's four boards. */
      standings: (image: StandingsImage) => draw(standingsScene(image), STANDINGS_WIDTH),
    };
  }),
}) {}
