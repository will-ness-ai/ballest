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
const mapCrumbs = () => (
  <Crumbs
    path={MAP}
    title="Sway n So"
    facts={FACTS}
    trail="maps"
  />
);
const links = () =>
  [...el.querySelectorAll(".ph-crumbs a")].map((a) => [a.textContent, a.getAttribute("href")]);

test("a Map reached from a player's page leads back there", () => {
  draw(<Remember trail="maps" href={PLAYER} label="Will" leads={["/map/1", MAP]} />);
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Players", "/players"],
    ["Will", PLAYER],
  ]);
  expect(el.querySelector(".ph-crumbs [aria-current=page]")?.textContent).toBe("Sway n So");
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

test("a Section's link or a search hit forgets where the reader came from", () => {
  draw(<Remember trail="maps" href={PLAYER} label="Will" leads={[MAP]} />);
  /* happy-dom loads no fonts */
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
  draw(<SectionRows nav={navOf("/daily", FACTS)} />);
  act(() => {
    el.querySelector<HTMLAnchorElement>('.sections a[href="/"]')?.click();
  });
  draw(mapCrumbs());
  expect(links()).toEqual([
    ["Maps", "/"],
    ["All Maps", "/maps"],
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
  draw(<Crumbs path="/daily" title="Sway n So" facts={FACTS} />);
  expect(el.querySelector(".ph-crumbs")).toBeNull();
});
