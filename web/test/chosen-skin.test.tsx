// A player's marble (components/Marble.tsx) draws the Skin their run was rolled with, else
// the Chosen Skin they picked (CONTEXT.md), else the glass ball in their hue.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ChosenSkins } from "../components/ChosenSkins";
import { Marble } from "../components/Marble";

const ADA = "76561190000000001";
const BO = "76561190000000002";
const GOLD = "/Game/Art/M_GoldReal.M_GoldReal";
const chosen = { [ADA]: "/skins/DA_Skin_Pink.webp" };

/* the picture the marble draws, or "hue" for the glass ball */
const drawn = (who: Parameters<typeof Marble>[0]["who"]) => {
  const html = renderToStaticMarkup(
    <ChosenSkins value={chosen}>
      <Marble who={who} />
    </ChosenSkins>,
  );
  return (
    /<img class="ball skin" src="([^"]+)"/.exec(html)?.[1] ??
    (html.includes("<svg") ? "hue" : "none")
  );
};

describe("the marble's Skin", () => {
  test("the run's Skin wins over the player's Chosen Skin", () => {
    expect(drawn({ steamId: ADA, skin: GOLD })).toBe("/skins/DA_Skin_MedalGold.webp");
  });
  test("with no run Skin, the Chosen Skin", () => {
    expect(drawn({ steamId: ADA })).toBe("/skins/DA_Skin_Pink.webp");
    expect(drawn({ steamId: ADA, skin: "/Game/Art/New/MI_NewSkin.MI_NewSkin" })).toBe(
      "/skins/DA_Skin_Pink.webp",
    );
  });
  test("with neither, the glass ball in their hue", () => {
    expect(drawn({ steamId: BO })).toBe("hue");
  });
  test("outside any page's Chosen Skins, the run's Skin or the hue", () => {
    expect(renderToStaticMarkup(<Marble who={{ steamId: ADA }} />)).toContain("<svg");
  });
});
