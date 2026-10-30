// @vitest-environment happy-dom
// The Official Section's chip on a phone (components/board/SeasonSwitch.tsx): its menu gives
// each season and the Trials, so a Trial's board has a way back to /trials and to the seasons.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { SeasonChip } from "../components/board/SeasonSwitch";

vi.mock("next/link", () => ({
  default: ({ href, ...rest }: { href: string } & React.ComponentProps<"a">) => (
    <a href={href} {...rest} />
  ),
}));

const SEASONS = [
  { group: "Season 2", overall: "OverallLeaderboard_EASeason2", players: 900, tracks: 12 },
  { group: "Season 1", overall: "OverallLeaderboard_EASeason1", players: 1200, tracks: 15 },
];

const links = (on: string) => {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(
    <SeasonChip seasons={SEASONS} on={on} board="Map_TheTower" />,
  );
  return [...div.querySelectorAll("a")].map((a) => ({
    href: a.getAttribute("href"),
    on: a.getAttribute("aria-current") === "true",
    label: a.querySelector("b")?.textContent,
  }));
};

test("on a Trial's board the chip's menu lists the seasons and the Trials, the Trials lit", () => {
  expect(links("Trials")).toEqual([
    { href: "/board/OverallLeaderboard_EASeason2", on: false, label: "Season 2" },
    { href: "/board/OverallLeaderboard_EASeason1", on: false, label: "Season 1" },
    { href: "/trials", on: true, label: "Trials" },
  ]);
});

test("on a season's board the Trials are there, unlit", () => {
  expect(links("Season 1").map((l) => [l.label, l.on])).toEqual([
    ["Season 2", false],
    ["Season 1", true],
    ["Trials", false],
  ]);
});
