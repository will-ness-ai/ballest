// The Prefabs page's How to tab: the guide answers what players ask in the game's Discord
// (how to select, save, spawn, share and ungroup a Prefab, and what a Decal is), and the ? on a
// Prefab's viewer points to it.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { HelpDialog } from "../components/prefabs/HowTo";
import { PrefabGuide } from "../components/prefabs/PrefabGuide";
import { PrefabsHead } from "../components/prefabs/PrefabTabs";
import { prefabGuideHref } from "../lib/routes";

/* the markup's text, tags dropped */
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ");

test("the tabs offer the guide, lit on its own page", () => {
  const html = renderToStaticMarkup(<PrefabsHead on="guide" blurb="" />);
  const lit = /<a [^>]*aria-current="page"[^>]*>/.exec(html)?.[0] ?? "";
  expect(lit).toContain(`href="${prefabGuideHref()}"`);
  expect(text(html)).toContain("How to");
});

test("the guide gives the save and spawn commands and the folder both use", () => {
  const t = text(renderToStaticMarkup(<PrefabGuide />));
  expect(t).toContain("ballest.editor.saveprefab");
  expect(t).toContain("ballest.editor.spawnprefab");
  expect(t).toContain("%LOCALAPPDATA%\\Ballest\\Saved\\SaveGames\\Prefabs");
  expect(t).toMatch(/Shift/);
  expect(t).toMatch(/ungroup/i);
  expect(t).toMatch(/Decal/);
});

test("the how-to on a Prefab's viewer links to the whole guide", () => {
  const html = renderToStaticMarkup(<HelpDialog name="bench" auto={false} />);
  expect(html).toContain(`href="${prefabGuideHref()}"`);
  expect(text(html)).toContain("ballest.editor.spawnprefab bench");
});
