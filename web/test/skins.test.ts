// The skin catalogue (lib/skins.ts): every skin it lists has its picture in the root
// skins/ folder, which scripts/sync-site.mjs publishes, and a skin it doesn't list draws
// the marble.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { SKINS, skinPicture } from "../lib/skins";

const ROOT = join(import.meta.dirname, "..", "..");

describe("skins", () => {
  test("every listed skin has its picture, and every picture a skin", () => {
    const assets = [...SKINS.values()];
    for (const a of assets) expect(existsSync(join(ROOT, "skins", a + ".webp")), a).toBe(true);
    expect(readdirSync(join(ROOT, "skins")).sort()).toEqual(assets.map((a) => a + ".webp").sort());
  });

  test("a Ghost's skin path draws its picture; none or an unknown one draws the marble", () => {
    expect(skinPicture("/Game/Art/M_GoldReal.M_GoldReal")).toBe("/skins/DA_Skin_MedalGold.webp");
    expect(skinPicture(null)).toBeNull();
    expect(skinPicture("/Game/Art/New/MI_NewSkin.MI_NewSkin")).toBeNull();
  });
});
