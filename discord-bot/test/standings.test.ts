// The standings image's layout, read from the scene before it is drawn. How it looks is checked
// by eye (`pnpm render:samples`); what each row says is something a test can hold it to.
import { describe, expect, it } from "vitest";
import { type El, standingsScene } from "../src/render/scenes.js";

const textsOf = (el: El): Array<string> =>
  (el.props.children ?? []).flatMap((c) =>
    c === null ? [] : typeof c === "string" ? [c] : textsOf(c),
  );

const scene = (board: Parameters<typeof standingsScene>[0]["boards"][number]) =>
  textsOf(standingsScene({ title: "Daily Report", subtitle: "", boards: [board] }));

describe("the standings image", () => {
  it("shows a row's move after its rank and its gain before its number", () => {
    const texts = scene({
      title: "Most world records",
      rows: [
        { name: "Amy", n: 4, move: 2, gain: 3 },
        { name: "Bob", n: 2, move: "new", gain: -1 },
        { name: "Cy", n: 1, move: 0, gain: 0 },
      ],
      out: [],
    });
    expect(texts).toEqual([
      "Daily Report",
      "",
      "Most world records",
      ...["1", "2", "Amy", "+3", "4"],
      ...["2", "NEW", "Bob", "−1", "2"],
      ...["3", "Cy", "1"],
    ]);
  });

  it("puts who left the top 10 under the board, in place of 'Nobody yet'", () => {
    const texts = scene({ title: "Most top 5s", rows: [], out: ["Low5ive"] });
    expect(texts.slice(-3)).toEqual(["–", "OUT", "Low5ive"]);
    expect(texts).not.toContain("Nobody yet");
  });
});
