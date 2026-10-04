// The progression graph's layout, read from the scene before it is drawn. How it looks is checked
// by eye (`pnpm render:samples`); where each name sits is something a test can hold it to.
import { describe, expect, it } from "vitest";
import { type El, progressionScene } from "../src/render/scenes.js";
import { ALICE, BOB, CARA, cardView, drawnMap, ticks } from "./harness.js";

/** How far down the image the absolutely placed box holding `text` starts. */
const topOf = (el: El, text: string, top: number | null = null): number | null => {
  const here = el.props.style?.position === "absolute" ? Number(el.props.style.top) : top;
  for (const child of el.props.children ?? []) {
    if (child === text) return here;
    if (child !== null && typeof child !== "string") {
      const found = topOf(child, text, here);
      if (found !== null) return found;
    }
  }
  return null;
};

describe("the progression graph", () => {
  it("names each line beside where it ends", () => {
    // Slower times sit higher on the chart, so the winner's line ends lowest.
    const view = cardView("m1", {
      state: "finished",
      type: "lobby",
      minutes: 5,
      players: [ALICE, BOB, CARA],
      map: drawnMap(),
      standings: [
        { player: ALICE, ticks: ticks(19), rank: 1, medal: "author" },
        { player: CARA, ticks: ticks(22), rank: 2, medal: "gold" },
        { player: BOB, ticks: ticks(27), rank: 3, medal: "silver" },
      ],
    });
    const history = [
      { steamId: ALICE.steamId, ticks: ticks(31), at: 20_000 },
      { steamId: BOB.steamId, ticks: ticks(27), at: 40_000 },
      { steamId: CARA.steamId, ticks: ticks(22), at: 60_000 },
      { steamId: ALICE.steamId, ticks: ticks(19), at: 200_000 },
    ];
    const names = new Map([
      [ALICE.discordId, "Alice"],
      [BOB.discordId, "Bob"],
      [CARA.discordId, "Cara"],
    ]);
    const scene = progressionScene({ view, history, names });
    const [bob, cara, alice] = ["Bob", "Cara", "Alice"].map((n) => topOf(scene, n) ?? NaN);
    expect(bob).toBeLessThan(cara ?? NaN);
    expect(cara).toBeLessThan(alice ?? NaN);
  });
});
