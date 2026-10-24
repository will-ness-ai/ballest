// The standings image's layout, read from the scene before it is drawn. How it looks is checked
// by eye (`pnpm render:samples`); what each row says is something a test can hold it to.
import { describe, expect, it } from "vitest";
import { NO_SKIN_PICTURES } from "../src/render/art.js";
import { type El, standingsScene } from "../src/render/scenes.js";

const textsOf = (el: El): Array<string> =>
  (el.props.children ?? []).flatMap((c) =>
    c === null ? [] : typeof c === "string" ? [c] : textsOf(c),
  );

const scene = (board: Parameters<typeof standingsScene>[0]["boards"][number]) =>
  textsOf(
    standingsScene({ title: "Daily Report", subtitle: "", boards: [board] }, NO_SKIN_PICTURES),
  );

describe("the standings image", () => {
  it("shows a row's move after its place and its gain before its number", () => {
    const texts = scene({
      title: "Most world records",
      rows: [
        { steamId: "s-Amy", skin: null, name: "Amy", n: 4, place: 1, move: 2, gain: 3 },
        { steamId: "s-Bob", skin: null, name: "Bob", n: 2, place: 2, move: "new", gain: -1 },
        { steamId: "s-Cy", skin: null, name: "Cy", n: 2, place: 2, move: 0, gain: 0 },
      ],
      out: [],
    });
    // Bob and Cy are level, so they share second
    expect(texts).toEqual([
      "Daily Report",
      "",
      "Most world records",
      ...["1", "2", "Amy", "+3", "4"],
      ...["2", "NEW", "Bob", "−1", "2"],
      ...["2", "Cy", "2"],
    ]);
  });

  it("puts who left the top 10 under the board, in place of 'Nobody yet'", () => {
    const texts = scene({ title: "Most top 5s", rows: [], out: ["Low5ive"] });
    expect(texts.slice(-3)).toEqual(["–", "OUT", "Low5ive"]);
    expect(texts).not.toContain("Nobody yet");
  });
});
