// The marble emojis that start a Match Thread's lines: the emoji of the Chosen Skin a post
// carries for its player, else the hue marble nearest theirs. Each is an application emoji, uploaded at startup
// once; over a fake of Discord's application emojis.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { Discord, DiscordError } from "../src/discord/client.js";
import { Marbles } from "../src/discord/marbles.js";
import { Renderer } from "../src/render/renderer.js";
import { ALICE, BOB, CARA } from "./harness.js";

const PINK = "/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink";
const GOLD = "/Game/Art/M_GoldReal.M_GoldReal";

/**
 * Marbles over an application holding `existing` emojis, refusing uploads named in `refused`;
 * and the names it uploaded.
 */
const setup = (opts: {
  readonly existing?: ReadonlyArray<string>;
  readonly refused?: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const uploaded = yield* Ref.make<Array<string>>([]);
    const discord = Discord.make({
      appEmojis: Effect.succeed(new Map((opts.existing ?? []).map((n) => [n, `id-${n}`]))),
      createAppEmoji: (name: string) =>
        (opts.refused ?? []).includes(name)
          ? Effect.fail(new DiscordError({ op: "create app emoji", cause: "refused" }))
          : Ref.update(uploaded, (u) => [...u, name]).pipe(Effect.as(`id-${name}`)),
    } as never);
    const marbles = yield* Marbles.pipe(
      Effect.provide(
        Marbles.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Discord, discord),
              Layer.succeed(Renderer, {
                marble: () => Effect.succeed(Buffer.from("png")),
              } as unknown as Renderer),
            ),
          ),
        ),
      ),
    );
    return { emojis: marbles, uploaded: yield* Ref.get(uploaded) };
  });

describe("a Match Thread line's marble", () => {
  it.effect("is the Chosen Skin its post carries, or the player's hue marble without one", () =>
    Effect.gen(function* () {
      const { emojis } = yield* setup({});
      expect(emojis.forPlayer(ALICE.steamId, PINK)).toBe("<:skin_Pink:id-skin_Pink>");
      expect(emojis.forPlayer(BOB.steamId, null)).toMatch(/^<:marble_\d{3}:id-marble_\d{3}>$/);
    }),
  );

  it.effect("uploads every Skin's emoji once, at startup", () =>
    Effect.gen(function* () {
      const { uploaded } = yield* setup({ existing: ["skin_Pink"] });
      expect(uploaded).toContain("skin_MedalGold");
      expect(uploaded).toContain("skin_Default_Black");
      expect(uploaded).not.toContain("skin_Pink");
    }),
  );

  it.effect(
    "is the hue marble for a Skin whose emoji Discord refused, or one it doesn't know",
    () =>
      Effect.gen(function* () {
        const { emojis } = yield* setup({ refused: ["skin_MedalGold"] });
        expect(emojis.forPlayer(ALICE.steamId, GOLD)).toMatch(/^<:marble_/);
        expect(emojis.forPlayer(CARA.steamId, "/Game/Art/Some/Future/Skin.Skin")).toMatch(
          /^<:marble_/,
        );
      }),
  );
});
