// The progression graph's layout, read from the scene before it is drawn. How it looks is checked
// by eye (`pnpm render:samples`); where each name sits is something a test can hold it to.
import { describe, expect, it } from "vitest";
import { type El, progressionScene } from "../src/render/scenes.js";
import { ALICE, BOB, CARA, cardView, DAN, drawnMap, ticks } from "./harness.js";

/** Every string in the scene, in order. */
const textsOf = (el: El): Array<string> =>
  (el.props.children ?? []).flatMap((c) =>
    c === null ? [] : typeof c === "string" ? [c] : textsOf(c),
  );

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

  it("names a line drawn from a PB brought into the Match, with no time in it", () => {
    const view = cardView("m1", {
      state: "finished",
      type: "lobby",
      minutes: 5,
      players: [ALICE, DAN],
      map: { ...drawnMap(), personalBests: { [DAN.steamId]: ticks(23) } },
      standings: [
        { player: ALICE, ticks: ticks(19), rank: 1, medal: "author" },
        { player: DAN, ticks: null, rank: null, medal: null },
      ],
    });
    const history = [{ steamId: ALICE.steamId, ticks: ticks(19), at: 20_000 }];
    const names = new Map([
      [ALICE.discordId, "Alice"],
      [DAN.discordId, "Dan"],
    ]);
    const scene = progressionScene({ view, history, names });
    expect(topOf(scene, "Dan")).toBeLessThan(topOf(scene, "Alice") ?? NaN);
    expect(textsOf(scene).filter((t) => t.startsWith("No time"))).toEqual([]);
  });

  it("fits a big Lobby's names beside the chart, below the title", () => {
    const players = Array.from({ length: 14 }, (_, i) => ({
      discordId: `d-p${i}`,
      steamId: `s-p${i}`,
    }));
    const view = cardView("m1", {
      state: "finished",
      type: "lobby",
      minutes: 5,
      players,
      map: drawnMap(),
      standings: players.map((player, i) => ({
        player,
        ticks: ticks(20 + i * 0.1),
        rank: i + 1,
        medal: "gold" as const,
      })),
    });
    const history = players.map((p, i) => ({
      steamId: p.steamId,
      ticks: ticks(20 + i * 0.1),
      at: 10_000 * (i + 1),
    }));
    const names = new Map(players.map((p, i) => [p.discordId, `P${i}`]));
    const scene = progressionScene({ view, history, names });
    const tops = players.map((_, i) => topOf(scene, `P${i}`) ?? NaN);
    // Slowest highest, each lower than the one before, all between the title and the clock.
    tops.forEach((top, i) => {
      expect(top).toBeGreaterThanOrEqual(90);
      expect(top).toBeLessThanOrEqual(410);
      if (i > 0) expect(top).toBeLessThan(tops[i - 1] ?? NaN);
    });
  });
});
