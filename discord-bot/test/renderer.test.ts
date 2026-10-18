// The Renderer through its interface. Drawing is checked by eye (`pnpm render:samples`); what a
// test can hold it to is that every image it draws is let go. A Card redraws each time a time
// lands, so memory kept per draw adds up until the machine runs out: it once took production down.
import { performance } from "node:perf_hooks";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { ChosenSkins } from "../src/chosenSkins.js";
import { Renderer } from "../src/render/renderer.js";
import { ALICE, BOB, cardView, drawnMap, ticks } from "./harness.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** The process's resident memory after a full collection, in MB. */
const resident = () => {
  gc();
  return process.memoryUsage().rss / 1048576;
};

const live = cardView("m1", {
  state: "live",
  type: "lobby",
  players: [ALICE, BOB],
  map: drawnMap(),
  standings: [
    { player: ALICE, ticks: ticks(19), rank: 1, medal: "author" },
    { player: BOB, ticks: ticks(24), rank: 2, medal: "gold" },
  ],
});
const names = new Map([
  [ALICE.discordId, "Alice"],
  [BOB.discordId, "Bob"],
]);

/** The Renderer over Chosen Skins where Alice has picked `skin`, or nobody has. */
const rendererWith = (skin: string | null) =>
  Renderer.Default.pipe(
    Layer.provide(
      Layer.succeed(
        ChosenSkins,
        ChosenSkins.of({
          all: Effect.succeed(new Map(skin === null ? [] : [[ALICE.steamId, skin]])),
        }),
      ),
    ),
  );
const aliceLink = Effect.flatMap(Renderer, (r) =>
  r.link({
    steamId: ALICE.steamId,
    personaName: "Alice",
    avatarUrl: "",
    campaignTracks: 3,
    campaignTrackTotal: 23,
  }),
);

describe("the Renderer", () => {
  it.effect(
    "draws a player's Chosen Skin, and their marble for a Skin it has no picture of",
    () =>
      Effect.gen(function* () {
        const marble = yield* aliceLink.pipe(Effect.provide(rendererWith(null)));
        const pink = yield* aliceLink.pipe(
          Effect.provide(
            rendererWith("/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink"),
          ),
        );
        const unknown = yield* aliceLink.pipe(
          Effect.provide(rendererWith("/Game/Art/Some/Future/Skin.Skin")),
        );
        expect(pink.equals(marble)).toBe(false);
        expect(unknown.equals(marble)).toBe(true);
      }),
    60_000,
  );

  it.effect(
    "lets go of every image it draws",
    () =>
      Effect.gen(function* () {
        const renderer = yield* Renderer;
        // Warm up: fonts, layout and the rasteriser's own buffers settle first.
        for (let i = 0; i < 5; i++) yield* renderer.card({ view: live, names, preview: null });
        const before = resident();
        // Each live Card is about 3 MB of pixels; kept, 40 of them would be over 100 MB.
        for (let i = 0; i < 40; i++) yield* renderer.card({ view: live, names, preview: null });
        expect(resident() - before).toBeLessThan(40);
      }).pipe(Effect.provide(rendererWith(null))),
    60_000,
  );

  it.effect(
    "keeps the bot answering while it draws",
    () =>
      Effect.gen(function* () {
        const renderer = yield* Renderer;
        yield* renderer.card({ view: live, names, preview: null });
        // A draw takes about a second; a 10 ms timer set while it runs must still fire on time.
        const drawing = yield* Effect.fork(renderer.card({ view: live, names, preview: null }));
        const late = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const start = performance.now();
              setTimeout(() => resolve(performance.now() - start - 10), 10);
            }),
        );
        yield* Fiber.join(drawing);
        expect(late).toBeLessThan(300);
      }).pipe(Effect.provide(rendererWith(null))),
    60_000,
  );
});
