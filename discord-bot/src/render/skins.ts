// Each ball Skin's picture, read from assets/skins/: the site's root skins/, copied in as PNGs by
// scripts/skin_pngs.py, since resvg reads no WebP and the Fly image is built from discord-bot/
// alone. The list of Skins is skinList.ts.
import { readFile } from "node:fs/promises";
import { Data, Effect } from "effect";
import { SKINS } from "./skinList.js";

const PICTURES = new URL("../../assets/skins/", import.meta.url);

/** A Skin's picture that couldn't be read from the image's assets/skins/. */
export class SkinPictureMissing extends Data.TaggedError("SkinPictureMissing")<{
  readonly asset: string;
  readonly cause: unknown;
}> {}

/**
 * Each Skin's picture as a PNG (128px, already round), by object path: read once at startup and
 * shared by the Renderer (for the images) and Marbles (for the emojis). A picture missing from
 * the image is a defect, which stops the bot there.
 */
export class SkinPictures extends Effect.Service<SkinPictures>()("multiballs/SkinPictures", {
  effect: Effect.forEach(
    [...SKINS],
    ([path, asset]) =>
      Effect.tryPromise({
        try: () => readFile(new URL(`${asset}.png`, PICTURES)),
        catch: (cause) => new SkinPictureMissing({ asset, cause }),
      }).pipe(Effect.map((png) => [path, png] as const)),
    { concurrency: 8 },
  ).pipe(
    Effect.map((pairs): { readonly pngs: ReadonlyMap<string, Buffer> } => ({
      pngs: new Map(pairs),
    })),
    Effect.tap(({ pngs }) => Effect.log(`skin pictures loaded (${pngs.size})`)),
    Effect.orDie,
  ),
}) {}
