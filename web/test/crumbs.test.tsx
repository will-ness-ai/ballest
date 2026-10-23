// @vitest-environment happy-dom
// A page's breadcrumb (components/Crumbs.tsx): a page that names a trail leads back to the
// board, list or player this tab remembers the reader came from (Remember), and to its
// Section's sub-tab with nothing remembered or storage blocked.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";

import { Crumbs } from "../components/Crumbs";
import { Remember } from "../components/Trail";
import { crumbsOf, type NavFacts } from "../lib/nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FACTS: NavFacts = {
  workshop: true,
  daily: true,
  seasons: [{ group: "Season 2", overall: "OverallLeaderboard_EASeason2" }],
  campaigns: [],
};
const PLAYER = "/player/76561198259485267";
const MAP = "/map/3800958793";

let el: HTMLElement, root: Root;
beforeEach(() => {
  sessionStorage.clear();
  el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  el.remove();
});

const draw = (node: React.ReactNode) => {
  act(() => {
    root.render(node);
  });
};
const mapCrumbs = () => (
  <Crumbs
    path={MAP}
    title="Sway n So"
    crumbs={crumbsOf(MAP, FACTS, "Sway n So", null)}
    trail={{ name: "maps", facts: FACTS }}
  />
);
const links = () =>
  [...el.querySelectorAll(".ph-crumbs a")].map((a) => [a.textContent, a.getAttribute("href")]);

test("a Map reached from a player's page leads back there", () => {
  draw(<Remember trail="maps" href={PLAYER} label="Will" />);
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Players", "/players"],
    ["Will", PLAYER],
  ]);
  expect(el.querySelector(".ph-crumbs [aria-current=page]")?.textContent).toBe("Sway n So");
});

test("a Map reached from a board leads back to that board", () => {
  draw(<Remember trail="maps" href="/campaign/solar-trials" label="Solar Trials Overall" />);
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Campaigns", "/campaigns"],
    ["Solar Trials Overall", "/campaign/solar-trials"],
  ]);
});

test("with nothing remembered, a Map sits under All Maps", () => {
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Maps", "/"],
    ["All Maps", "/maps"],
  ]);
});

test("a breadcrumb that would be the title alone is not drawn", () => {
  draw(<Crumbs path="/daily" title="Sway n So" crumbs={[]} />);
  expect(el.querySelector(".ph-crumbs")).toBeNull();
});
