// Map previews through their interface, over a fake Steam image host: both surfaces (the Card and
// the Activity) get each Workshop preview from here, so what one shows the other shows.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, TestClock } from "effect";
import { MapPreviews, type Preview, PreviewSource, PreviewUnavailable } from "../src/previews.js";

const JPEG: Preview = { type: "image/jpeg", body: new Uint8Array([1, 2, 3]) };

/** A host that serves `images` by URL and counts every fetch. */
const setup = Effect.fn("setup")(function* (images: Record<string, Preview | "down">) {
  const fetches = yield* Ref.make(0);
  const source = PreviewSource.of({
    fetch: (url) =>
      Ref.update(fetches, (n) => n + 1).pipe(
        Effect.zipRight(
          images[url] === undefined || images[url] === "down"
            ? Effect.fail(new PreviewUnavailable({ reason: "404" }))
            : Effect.succeed(images[url]),
        ),
      ),
  });
  const previews = yield* MapPreviews.pipe(
    Effect.provide(MapPreviews.Default.pipe(Layer.provide(Layer.succeed(PreviewSource, source)))),
  );
  return { previews, fetches: Ref.get(fetches) };
});

describe("Map previews", () => {
  it.effect("fetch each preview once, however many times it's drawn", () =>
    Effect.gen(function* () {
      const { previews, fetches } = yield* setup({ "https://steam/a": JPEG });
      expect(yield* previews.of("https://steam/a")).toEqual(Option.some(JPEG));
      expect(yield* previews.of("https://steam/a")).toEqual(Option.some(JPEG));
      expect(yield* fetches).toBe(1);
    }),
  );

  it.effect(
    "draw the stand-in for a Map with no preview, and ask Steam again after five minutes",
    () =>
      Effect.gen(function* () {
        const { previews, fetches } = yield* setup({});
        expect(yield* previews.of("https://steam/gone")).toEqual(Option.none());
        expect(yield* previews.of("https://steam/gone")).toEqual(Option.none());
        expect(yield* fetches).toBe(1);
        yield* TestClock.adjust("5 minutes");
        yield* previews.of("https://steam/gone");
        expect(yield* fetches).toBe(2);
      }),
  );

  it.effect("have none for a Map without a preview URL, without asking Steam", () =>
    Effect.gen(function* () {
      const { previews, fetches } = yield* setup({});
      expect(yield* previews.of("")).toEqual(Option.none());
      expect(yield* fetches).toBe(0);
    }),
  );

  it.effect("keep only the most recent previews", () =>
    Effect.gen(function* () {
      const images = Object.fromEntries(
        Array.from({ length: 51 }, (_, i) => [`https://steam/${i}`, JPEG]),
      );
      const { previews, fetches } = yield* setup(images);
      for (let i = 0; i <= 50; i++) yield* previews.of(`https://steam/${i}`);
      yield* previews.of("https://steam/50");
      expect(yield* fetches).toBe(51);
      yield* previews.of("https://steam/0");
      expect(yield* fetches).toBe(52);
    }),
  );
});
