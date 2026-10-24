// The skin catalogue (lib/skins.ts): every skin it lists has its picture in the root
// skins/ folder, which scripts/sync-site.mjs publishes, and a skin it doesn't list draws
// the marble.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { SKIN_GROUPS, SKINS, skinName, skinPicture } from "../lib/skins";

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

  test("the picker's groups hold every skin once, each named, colours first", () => {
    const named = (group: string) =>
      SKIN_GROUPS.find((g) => g.group === group)?.skins.map((s) => s.name);
    expect(SKIN_GROUPS.map((g) => g.group)).toEqual(["Colours", "Metals", "Specials"]);
    expect(named("Metals")).toEqual(["Gold", "Silver", "Bronze", "Pearl"]);
    expect(named("Specials")).toEqual([
      "Brick",
      "Eyeball",
      "Ice",
      "Cosmic",
      "Magma",
      "Leth",
      "Snow Globe",
      "Disco",
      "Spirit",
      "Spooky",
    ]);
    expect(named("Colours")?.slice(0, 3)).toEqual(["Pink", "Light Pink", "Red"]);
    const all = SKIN_GROUPS.flatMap((g) => g.skins.map((s) => s.skin));
    expect(all.sort()).toEqual([...SKINS.keys()].sort());
  });

  test("a skin's name, or No skin for none or one the site doesn't know", () => {
    expect(skinName("/Game/Art/M_GoldReal.M_GoldReal")).toBe("Gold");
    expect(skinName("/Game/Art/Materials/Instances/Ball/MI_BallTurquiose.MI_BallTurquiose")).toBe(
      "Turquoise",
    );
    expect(skinName(null)).toBe("No skin");
    expect(skinName("/Game/Art/New/MI_NewSkin.MI_NewSkin")).toBe("No skin");
  });
});
