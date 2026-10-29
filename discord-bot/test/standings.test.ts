// The standings image's layout, read from the scene before it is drawn. How it looks is checked
// by eye (`pnpm render:samples`); what each row says is something a test can hold it to.
import { describe, expect, it } from "vitest";
import { NO_SKIN_PICTURES } from "../src/render/art.js";
import { type El, standingsScene } from "../src/render/scenes.js";

const textsOf = (el: El): Array<string> =>
  (el.props.children ?? []).flatMap((c) =>
    c === null ? [] : typeof c === "string" ? [c] : textsOf(c),
  );

type Image = Parameters<typeof standingsScene>[0];
const NO_OVERALL: Image["overall"] = { rows: [], out: [] };

const scene = (board: Image["boards"][number]) =>
  textsOf(
    standingsScene(
      { title: "Daily Report", subtitle: "", boards: [board], overall: NO_OVERALL },
      NO_SKIN_PICTURES,
    ),
  );
const overallScene = (overall: Image["overall"]) =>
  textsOf(
    standingsScene({ title: "Daily Report", subtitle: "", boards: [], overall }, NO_SKIN_PICTURES),
  );

const chips = (...places: Array<number | null>) =>
  places.map((place, i) => ({ board: ["MP", "AM", "WR", "T5"][i] ?? "", place }));

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
      "Overall",
      "10 points for 1st on a standing down to 1 for 10th, added across all four",
      "Nobody yet",
      "Most world records",
      ...["1", "2", "Amy", "+3", "4"],
      ...["2", "NEW", "Bob", "−1", "2"],
      ...["2", "Cy", "2"],
    ]);
  });

  it("puts who left the top 10 under the board, in place of 'Nobody yet'", () => {
    const texts = scene({ title: "Most top 5s", rows: [], out: ["Low5ive"] });
    expect(texts.slice(-3)).toEqual(["–", "OUT", "Low5ive"]);
    expect(texts.slice(texts.indexOf("Most top 5s"))).not.toContain("Nobody yet");
  });

  it("heads the image with Overall: each row's places on the four boards, then its points", () => {
    const texts = overallScene({
      rows: [
        {
          steamId: "s-Slati",
          skin: null,
          name: "Slati Jnr",
          points: 39,
          place: 1,
          move: 0,
          places: chips(1, 1, 2, 1),
        },
        {
          steamId: "s-Amy",
          skin: null,
          name: "Amy",
          points: 10,
          place: 2,
          move: "new",
          places: chips(null, null, 1, null),
        },
      ],
      out: ["Bob"],
    });
    expect(texts.slice(2)).toEqual([
      "Overall",
      "10 points for 1st on a standing down to 1 for 10th, added across all four",
      ...["1", "Slati Jnr", "MP", "1", "AM", "1", "WR", "2", "T5", "1", "39", "pts"],
      ...["2", "NEW", "Amy", "MP", "–", "AM", "–", "WR", "1", "T5", "–", "10", "pts"],
      ...["–", "OUT", "Bob"],
    ]);
  });
});
