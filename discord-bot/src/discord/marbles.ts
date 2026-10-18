// The small marbles that start each lifecycle line in a Match Thread. Discord can't colour an
// emoji per Player, so the application carries one marble emoji per hue step; a Player gets
// the step nearest their own hue. A Player with a Chosen Skin (chosenSkins.ts) gets that Skin's
// emoji instead: the application carries one per Skin, from the same pictures the images draw.
// Missing emojis are uploaded at startup, once.
import { Effect } from "effect";
import { ChosenSkins } from "../chosenSkins.js";
import { hueFor } from "../render/art.js";
import { Renderer, type RenderError } from "../render/renderer.js";
import { loadSkinPictures, skinEmojiName } from "../render/skins.js";
import { Discord, describeDiscordError, oneLine } from "./client.js";

const STEP = 15;
const HUES = Array.from({ length: 360 / STEP }, (_, i) => i * STEP);
const nameOf = (hue: number) => `marble_${String(hue).padStart(3, "0")}`;

export interface MarbleEmojis {
  /** The emoji nearest a hue, or nothing if Discord wouldn't take them. */
  readonly forHue: (hue: number) => string;
  /** A Player's Chosen Skin, else their marble, the same colour as on the Card and the site. */
  readonly forPlayer: (steamId: string) => string;
}

const NONE: MarbleEmojis = { forHue: () => "", forPlayer: () => "" };

export class Marbles extends Effect.Service<Marbles>()("multiballs/Marbles", {
  effect: Effect.gen(function* () {
    const chosenSkins = yield* ChosenSkins;
    const ids = yield* Effect.gen(function* () {
      const discord = yield* Discord;
      const renderer = yield* Renderer;
      const ids = new Map(yield* discord.appEmojis);
      // An emoji Discord won't take is skipped: its Players' lines go without it.
      const upload = (name: string, png: Effect.Effect<Buffer, RenderError>) =>
        ids.has(name)
          ? Effect.void
          : png.pipe(
              Effect.flatMap((png) => discord.createAppEmoji(name, png)),
              Effect.tap((id) => Effect.sync(() => ids.set(name, id))),
              Effect.catchAll((e) =>
                Effect.logWarning(
                  `marble emoji ${name} unavailable: ${e._tag === "DiscordError" ? describeDiscordError(e) : oneLine(e.cause)}`,
                ),
              ),
            );
      for (const hue of HUES) yield* upload(nameOf(hue), renderer.marble(hue));
      for (const [path, png] of yield* loadSkinPictures)
        yield* upload(skinEmojiName(path), Effect.succeed(png));
      const count = (prefix: string) => [...ids.keys()].filter((n) => n.startsWith(prefix)).length;
      yield* Effect.log(
        `marble emojis ready (${count("marble_")} of ${HUES.length}, ${count("skin_")} Skins)`,
      );
      return ids;
    }).pipe(
      Effect.catchAll((e) =>
        Effect.logWarning(
          `marble emojis unavailable (${describeDiscordError(e)}); lifecycle lines go without them`,
        ).pipe(Effect.as(null)),
      ),
    );
    if (ids === null) return { current: Effect.succeed(NONE) };

    const emoji = (name: string) => {
      const id = ids.get(name);
      return id === undefined ? null : `<:${name}:${id}>`;
    };
    const forHue = (hue: number) => emoji(nameOf((Math.round(hue / STEP) * STEP) % 360)) ?? "";
    return {
      /** The emojis as the Chosen Skins stand now, for one post's lines. */
      current: Effect.map(chosenSkins.all, (chosen): MarbleEmojis => ({
        forHue,
        forPlayer: (steamId) => {
          const skin = chosen.get(steamId);
          return (
            (skin === undefined ? null : emoji(skinEmojiName(skin))) ?? forHue(hueFor(steamId))
          );
        },
      })),
    };
  }),
}) {}
