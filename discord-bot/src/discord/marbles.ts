// The small marbles that start each lifecycle line in a Match Thread. Discord can't colour an
// emoji per Player, so the application carries one marble emoji per hue step; a Player gets
// the step nearest their own hue. A Player whose post carries a Chosen Skin gets that Skin's
// emoji instead: the application carries one per Skin, from the same pictures the images draw.
// Missing emojis are uploaded at startup, once.
import { Effect } from "effect";
import type { ChosenSkin } from "../ports.js";
import { hueFor } from "../render/art.js";
import { Renderer, type RenderError } from "../render/renderer.js";
import { skinEmojiName } from "../render/skinList.js";
import { SkinPictures } from "../render/skins.js";
import { Discord, describeDiscordError, oneLine } from "./client.js";

const STEP = 15;
const HUES = Array.from({ length: 360 / STEP }, (_, i) => i * STEP);
const nameOf = (hue: number) => `marble_${String(hue).padStart(3, "0")}`;

export interface MarbleEmojis {
  /** The emoji nearest a hue, or nothing if Discord wouldn't take them. */
  readonly forHue: (hue: number) => string;
  /**
   * A Player's line: the emoji of `skin`, the Chosen Skin their post carries, else their marble,
   * the same colour as on the Card and the site.
   */
  readonly forPlayer: (steamId: string, skin: ChosenSkin) => string;
}

const NONE: MarbleEmojis = { forHue: () => "", forPlayer: () => "" };

export class Marbles extends Effect.Service<Marbles>()("multiballs/Marbles", {
  effect: Effect.gen(function* () {
    const { pngs } = yield* SkinPictures;
    const ids = yield* Effect.gen(function* () {
      const discord = yield* Discord;
      const renderer = yield* Renderer;
      const ids = new Map(yield* discord.appEmojis);
      // An emoji Discord won't take is skipped: its Players' lines go without it.
      const upload = Effect.fn("Marbles.upload")(function* (
        name: string,
        png: Effect.Effect<Buffer, RenderError>,
      ) {
        if (ids.has(name)) return;
        yield* png.pipe(
          Effect.flatMap((png) => discord.createAppEmoji(name, png)),
          Effect.tap((id) => Effect.sync(() => ids.set(name, id))),
          Effect.catchTags({
            DiscordError: (e) =>
              Effect.logWarning(`marble emoji ${name} unavailable: ${describeDiscordError(e)}`),
            RenderError: (e) =>
              Effect.logWarning(`marble emoji ${name} unavailable: ${oneLine(e.cause)}`),
          }),
        );
      });
      for (const hue of HUES) yield* upload(nameOf(hue), renderer.marble(hue));
      for (const [path, png] of pngs) {
        const name = skinEmojiName(path);
        if (name !== null) yield* upload(name, Effect.succeed(png));
      }
      const count = (prefix: string) => [...ids.keys()].filter((n) => n.startsWith(prefix)).length;
      yield* Effect.log(
        `marble emojis ready (${count("marble_")} of ${HUES.length}, ${count("skin_")} Skins)`,
      );
      return ids;
    }).pipe(
      Effect.catchTag("DiscordError", (e) =>
        Effect.logWarning(
          `marble emojis unavailable (${describeDiscordError(e)}); lifecycle lines go without them`,
        ).pipe(Effect.as(null)),
      ),
    );
    if (ids === null) return NONE;

    const emoji = (name: string | null) => {
      const id = name === null ? undefined : ids.get(name);
      return id === undefined ? null : `<:${name}:${id}>`;
    };
    const forHue = (hue: number) => emoji(nameOf((Math.round(hue / STEP) * STEP) % 360)) ?? "";
    const emojis: MarbleEmojis = {
      forHue,
      forPlayer: (steamId, skin) =>
        (skin === null ? null : emoji(skinEmojiName(skin))) ?? forHue(hueFor(steamId)),
    };
    return emojis;
  }),
  dependencies: [SkinPictures.Default],
}) {}
