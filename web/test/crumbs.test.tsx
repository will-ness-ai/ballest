// @vitest-environment happy-dom
// A page's breadcrumb (components/Crumbs.tsx): a page that names a trail leads back to the
// board, list or player this tab remembers the reader came from (Remember), and to its
// Section's sub-tab with nothing remembered or storage blocked.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Crumbs } from "../components/Crumbs";
import { SectionRows } from "../components/SectionNav";
import { Remember } from "../components/Trail";
import { navOf, type NavFacts } from "../lib/nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FACTS: NavFacts = {
  workshop: true,
  daily: true,
  seasons: [{ group: "Season 2", overall: "OverallLeaderboard_EASeason2" }],
  campaigns: [],
};
const PLAYER = "/player/76561198259485267";
const MAP = "/map/3800958793";

vi.mock("next/link", () => ({
  default: ({ href, ...rest }: { href: string } & React.ComponentProps<"a">) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        /* the test stays on its page */
        e.preventDefault();
      }}
    />
  ),
}));

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
const mapCrumbs = () => <Crumbs path={MAP} title="Sway n So" facts={FACTS} trail="maps" />;
const links = () =>
  [...el.querySelectorAll(".ph-crumbs a")].map((a) => [a.textContent, a.getAttribute("href")]);

const WILL = "76561198259485267";
/* the Map's breadcrumb after Will's page, the Map on `board` made by `maker`, with the board
   answering `row` for Will */
async function afterPlayer(board: string, maker: string | null, row: unknown) {
  const fetch = vi.fn(() => Promise.resolve(Response.json(row)));
  vi.stubGlobal("fetch", fetch);
  try {
    draw(<Remember trail="maps" href={PLAYER} label="Will" player={WILL} />);
    await act(async () => {
      root.render(
        <Crumbs path={MAP} title="Sway n So" facts={FACTS} trail="maps" page={{ board, maker }} />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    return { links: links(), fetch };
  } finally {
    vi.unstubAllGlobals();
  }
}

test("a Map reached from the page of a player with a time on it leads back there", async () => {
  const { links: got, fetch } = await afterPlayer("Workshop_1", null, { rank: 3, score: 1 });
  expect(got).toEqual(UNDER_WILL);
  expect(fetch).toHaveBeenCalledWith(`/api/board/Workshop_1?player=${WILL}`);
  expect(el.querySelector(".ph-crumbs [aria-current=page]")?.textContent).toBe("Sway n So");
});

test("a Map reached from the page of the player who made it leads back there", async () => {
  const { links: got, fetch } = await afterPlayer("Workshop_2", WILL, null);
  expect(got).toEqual(UNDER_WILL);
  expect(fetch).not.toHaveBeenCalled();
});

test("a Map the remembered player neither made nor finished sits under All Maps", async () => {
  expect((await afterPlayer("Workshop_3", null, null)).links).toEqual(UNDER_ALL_MAPS);
});

test("a Map reached from a board leads back to that board", () => {
  draw(
    <Remember
      trail="maps"
      href="/campaign/solar-trials"
      label="Solar Trials Overall"
      leads={[MAP]}
    />,
  );
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Campaigns", "/campaigns"],
    ["Solar Trials Overall", "/campaign/solar-trials"],
  ]);
});

test("a Map the remembered page doesn't lead to sits under All Maps", () => {
  // the Daily on another day's Map, then this Map from the header or the search
  draw(<Remember trail="maps" href="/daily" label="Daily Today" leads={["/map/1"]} />);
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Maps", "/"],
    ["All Maps", "/maps"],
  ]);
});

test("a list of every Map leads to any of them", () => {
  draw(<Remember trail="maps" href="/maps/fresh" label="All maps" />);
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Maps", "/"],
    ["All maps", "/maps/fresh"],
  ]);
});

/* a click on a Section's link, from the homepage (happy-dom's page is "/"), after a player's
   page that leads to the Map; then the Map's breadcrumb */
function afterSection(href: string, click: MouseEventInit = {}) {
  draw(<Remember trail="maps" href={PLAYER} label="Will" leads={[MAP]} />);
  /* happy-dom loads no fonts */
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
  draw(<SectionRows nav={navOf("/", FACTS)} />);
  act(() => {
    el.querySelector(`.sections a[href="${href}"]`)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...click }),
    );
  });
  draw(mapCrumbs());
  return links();
}
const UNDER_ALL_MAPS = [
  ["Maps", "/"],
  ["All Maps", "/maps"],
];
const UNDER_WILL = [
  ["Players", "/players"],
  ["Will", PLAYER],
];

test("a Section's link that leaves the page forgets where the reader came from", () => {
  expect(afterSection("/daily")).toEqual(UNDER_ALL_MAPS);
});

test("a Section's link opened in a new tab, or the page's own, forgets nothing", () => {
  expect(afterSection("/daily", { ctrlKey: true })).toEqual(UNDER_WILL);
  expect(afterSection("/daily", { metaKey: true })).toEqual(UNDER_WILL);
  expect(afterSection("/daily", { shiftKey: true })).toEqual(UNDER_WILL);
  expect(afterSection("/")).toEqual(UNDER_WILL);
});

test("with nothing remembered, a Map sits under All Maps", () => {
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Maps", "/"],
    ["All Maps", "/maps"],
  ]);
});

test("a breadcrumb that would be the title alone is not drawn", () => {
  draw(<Crumbs path="/daily" title="Sway n So" facts={FACTS} />);
  expect(el.querySelector(".ph-crumbs")).toBeNull();
});
