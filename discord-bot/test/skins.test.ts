// The Skins the bot can draw for a Chosen Skin: the site's list (web/lib/skins.ts) with a
// picture for each, copied from the root skins/ by scripts/skin_pngs.py.
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SKINS as SITE_SKINS } from "../../web/lib/skins.js";
import { SKINS, skinEmojiName } from "../src/render/skinList.js";
import { SkinPictures } from "../src/render/skins.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];

describe("the bot's Skins", () => {
  it("are the site's Skins", () => {
    expect(SKINS).toEqual(SITE_SKINS);
  });

  it.effect("each have a PNG picture", () =>
    Effect.gen(function* () {
      const { pngs } = yield* SkinPictures.pipe(Effect.provide(SkinPictures.Default));
      for (const path of SITE_SKINS.keys()) {
        const png = pngs.get(path);
        expect([...(png ?? Buffer.alloc(0)).subarray(0, 4)], path).toEqual(PNG);
      }
    }),
  );

  it("each have an emoji name Discord takes, none shared", () => {
    const names = [...SKINS.keys()].map(skinEmojiName);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_]{2,32}$/);
    expect(new Set(names).size).toBe(names.length);
    expect(skinEmojiName("/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink")).toBe(
      "skin_Pink",
    );
  });

  it("have no emoji name for a Skin the list doesn't know", () => {
    expect(skinEmojiName("/Game/Art/Some/Future/Skin.Skin")).toBeNull();
  });
});
