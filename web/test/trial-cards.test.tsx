// @vitest-environment happy-dom
// /trials' cards (components/TrialCards.tsx, grill-design round 1, A): a card per Trial in
// the Trials' order, each linking its page, with its picture (a placeholder where none is
// extracted yet), its title, whether it is still open, its runs and its record with the
// record's holder. A Trial nobody has run says so.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test } from "vitest";

import { TrialCards } from "../components/TrialCards";
import type { TrialTop } from "../lib/rows";

const SLOWPOKE = { steamId: "76561199000000004", persona: "Slowpoke", avatar: null };
const TOPS: Array<TrialTop> = [
  { board: "Map_TheTower", runs: 3, record: 42_514_900, holder: SLOWPOKE },
  { board: "Map_TheTowerCP", runs: 1, record: 44_502_500, holder: SLOWPOKE },
  { board: "Map_LethTrial_01", runs: 0, record: null, holder: null },
];

let cards: Array<HTMLAnchorElement>;
beforeAll(() => {
  document.body.innerHTML = renderToStaticMarkup(<TrialCards tops={TOPS} />);
  cards = [...document.querySelectorAll<HTMLAnchorElement>("a")];
});
const text = (a: HTMLElement) => a.textContent.replace(/\s+/g, " ");

describe("TrialCards", () => {
  test("a card per Trial, in the Trials' order, each linking its page", () => {
    expect(cards.map((a) => [a.querySelector("h2")?.textContent, a.getAttribute("href")])).toEqual([
      ["The Tower", "/board/Map_TheTower"],
      ["The Tower (Checkpoints)", "/board/Map_TheTowerCP"],
      ["Leth Trial #1", "/board/Map_LethTrial_01"],
    ]);
  });

  test("each card gives its runs, its record and who holds it", () => {
    expect(text(cards[0])).toContain("Open · 3 runs");
    expect(text(cards[0])).toContain("Slowpoke 7:05.149");
    expect(text(cards[1])).toContain("Open · 1 run");
    expect(text(cards[1])).toContain("Slowpoke 7:25.025");
  });

  test("an Event board is closed, and one nobody has run has no record", () => {
    expect(text(cards[2])).toContain("Closed · 0 runs");
    expect(text(cards[2])).toContain("No times yet");
  });

  test("a Tower waits on its picture; Leth Trial #1 shows its own", () => {
    expect(cards[0].querySelector("img")).toBeNull();
    expect(cards[0].querySelector(".trc-pic")).not.toBeNull();
    expect(cards[2].querySelector("img")?.getAttribute("src")).toBe("/leth/screenshot.jpg");
  });
});
